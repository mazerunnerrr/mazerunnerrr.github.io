/**
 * Звук сайта. Если в админке загружен трек — играет он, по кругу. Если нет —
 * звук мира: ветер и низкий гул, собранные прямо в браузере, без файлов.
 *
 * Включается только по нажатию: браузер не даёт звуку начаться самому, и это
 * правильно. Всё идёт через анализатор — по нему переключатель рисует волну,
 * пока звук играет. У звука мира рука раздувает ветер, а пролёт по кругу
 * делает его выше и громче.
 */
/* Полосы для волны в переключателе — по линии на каждую (Илья, 2026-10-18).
   Шаг анализатора ~21 Гц. hit — сколько даёт удар, level — сколько уровень,
   fall — как быстро линия опадает. */
export const BANDS = [
  /* Главная линия — ноты: отдельные удары фортепиано и духового синтезатора,
     «пум-пум-пум» (Илья, 2026-10-18). Ловятся не по громкости полосы, а по
     появлению новых нот в каждой частоте отдельно (notes): новая нота
     поднимает свою частоту, даже когда общая громкость почти не меняется. */
  { from: 18, to: 140, notes: true, hit: 1, level: 0.12, fall: 6 }, // ~390–3000 Гц
  { from: 2, to: 6, hit: 0.95, level: 0.35, fall: 5 }, // ~40–130 Гц: бочка
  { from: 6, to: 14, hit: 0.55, level: 0.6, fall: 3 }, // ~130–300 Гц: бас
  // Верха в сигнале слабее остальных — у мелодики чувствительность выше.
  { from: 95, to: 280, hit: 0.9, level: 1.8, fall: 6 }, // ~2–6 кГц: мелкая мелодика
];

/** Фильтр открыт — звук целиком; в комнате — срез до глухих низов. */
const OPEN_HZ = 18000;
const DUCK_HZ = 320;
/** Громкость в комнате от обычной: музыка уходит в фон и не отвлекает. */
const DUCK_GAIN = 0.4;

export class Ambience {
  private ctx: AudioContext;
  private master: GainNode;
  /** Приглушение в комнате: срез верхов и чуть тише — музыка уходит «за стену». */
  private duckGain: GainNode;
  private duckFilter: BiquadFilterNode;
  private analyser: AnalyserNode;
  private freq: Uint8Array<ArrayBuffer>;
  /** Огибающая каждой линии волны: мгновенно вверх на ударе, плавно вниз. */
  private env = new Float32Array(BANDS.length);
  /** Энергия полос в прошлом кадре — удар это резкий рост, а не громкость. */
  private prev = new Float32Array(BANDS.length);
  /** Средний рост за последние секунды: порог, над которым рост — удар. */
  private avgRise = new Float32Array(BANDS.length);
  /** Спектр прошлого кадра по частотам — для ловли новых нот. */
  private prevSpec: Float32Array | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private track: HTMLAudioElement | null = null;
  private on = false;

  constructor(music?: string) {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.duckGain = ctx.createGain();
    this.duckFilter = ctx.createBiquadFilter();
    this.duckFilter.type = "lowpass";
    this.duckFilter.frequency.value = OPEN_HZ;
    this.analyser = ctx.createAnalyser();
    // Полоса ~21 Гц: бочку от баса и фортепиано от голоса уже можно различить.
    // Сглаживание слабое — иначе анализатор сам размазывает удары.
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.35;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.master.connect(this.duckGain).connect(this.duckFilter).connect(this.analyser).connect(ctx.destination);

    if (music) {
      const a = new Audio(music);
      a.loop = true;
      a.preload = "auto";
      this.track = a;
      ctx.createMediaElementSource(a).connect(this.master);
      return;
    }

    // Ветер: белый шум через полосовой фильтр. Буфер на две секунды по кругу —
    // на слух шум не повторяется.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 380;
    windFilter.Q.value = 0.8;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.16;
    noise.connect(windFilter).connect(windGain).connect(this.master);
    noise.start();
    this.windFilter = windFilter;
    this.windGain = windGain;

    // Дыхание ветра: медленная волна по частоте фильтра, раз в четырнадцать секунд.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 140;
    lfo.connect(depth).connect(windFilter.frequency);
    lfo.start();

    // Гул: квинта на низах, чуть расстроенная — от этого он живой.
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 220;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.1;
    for (const [f, detune] of [
      [55, -4],
      [82.4, 5],
      [110, 2],
    ]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(droneFilter);
      o.start();
    }
    droneFilter.connect(droneGain).connect(this.master);
  }

  /** Включение и выключение плавные: без щелчка в колонках. */
  set(on: boolean) {
    this.on = on;
    const t = this.ctx.currentTime;
    if (on) {
      void this.ctx.resume();
      void this.track?.play().catch(() => {});
    }
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, t, on ? 0.6 : 0.25);
    // Выключенный звук не держит аудиопоток открытым. Проверка флага — на случай,
    // если звук включили обратно раньше, чем истекла пауза.
    if (!on)
      window.setTimeout(() => {
        if (this.on) return;
        this.track?.pause();
        void this.ctx.suspend();
      }, 1500);
  }

  /** Несколько раз в секунду: рука и пролёт, оба от 0 до 1. */
  drive(hand: number, flight: number) {
    if (!this.on || !this.windFilter || !this.windGain) return;
    const t = this.ctx.currentTime;
    const energy = Math.min(1, hand * 0.8 + flight * 0.9);
    this.windFilter.frequency.setTargetAtTime(380 + energy * 900, t, 0.25);
    this.windGain.gain.setTargetAtTime(0.16 + energy * 0.34, t, 0.2);
  }

  /** Вход в комнату и выход. Как у Active Theory: срез верхов идёт по
      логарифму — на слух это ровное «погружение», — только дольше и
      с лёгким спадом громкости. */
  duck(on: boolean) {
    const t = this.ctx.currentTime;
    const f = this.duckFilter.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.exponentialRampToValueAtTime(on ? DUCK_HZ : OPEN_HZ, t + (on ? 1.1 : 1.4));
    this.duckGain.gain.cancelScheduledValues(t);
    this.duckGain.gain.setTargetAtTime(on ? DUCK_GAIN : 1, t, on ? 0.35 : 0.5);
  }

  /** Пульс музыки по полосам, каждая 0..1 — по линии волны на полосу.
      Удар — резкий рост энергии полосы над её средним ростом; к нему
      подмешан уровень полосы, чтобы линия жила и между ударами. Вверх
      мгновенно, вниз — со скоростью своей полосы. */
  bands(dt: number, out: Float32Array) {
    const f = this.freq;
    this.analyser.getByteFrequencyData(f);
    const prevSpec = (this.prevSpec ??= Float32Array.from(f));
    const k = Math.min(1, dt * 2);
    BANDS.forEach((band, i) => {
      let sum = 0;
      let flux = 0;
      for (let j = band.from; j < band.to; j++) {
        sum += f[j];
        flux += Math.max(0, f[j] - prevSpec[j]);
      }
      const width = (band.to - band.from) * 255;
      const level = sum / width;
      // Рост: у нот — сумма прибавок по отдельным частотам, у остальных —
      // прибавка общей громкости полосы.
      const rise = band.notes ? flux / width : Math.max(0, level - this.prev[i]);
      this.prev[i] = level;
      this.avgRise[i] += (rise - this.avgRise[i]) * k;
      const hit = band.notes
        ? Math.min(1, Math.max(0, rise / (this.avgRise[i] + 0.002) - 1.3) / 2)
        : Math.min(1, Math.max(0, rise / (this.avgRise[i] + 0.003) - 1.2) / 2.5);
      const target = Math.min(1, hit * band.hit + level * band.level);
      this.env[i] = target > this.env[i] ? target : this.env[i] * Math.exp(-dt * band.fall);
      out[i] = this.env[i];
    });
    prevSpec.set(f);
  }

  close() {
    this.track?.pause();
    void this.ctx.close();
  }
}
