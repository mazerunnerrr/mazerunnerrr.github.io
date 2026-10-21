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
/** Громкость щелчка надписи и самый частый щелчок, с. */
const TICK_GAIN = 0.09;
const TICK_GAP = 0.035;
/* Громкость трека из админки (Илья, 2026-10-21: «на средней громкости Мака —
   как на максимальной»). Трек сведён громко: −8,7 LUFS, пики +1,4 dBFS, —
   на 5 дБ громче, чем ютуб приводит любой ролик (−14 LUFS). Фоновой музыке
   место ниже: ×0,25 (−12 дБ) даёт ~−21,5 LUFS, и шкала Мака снова работает
   от тихого к громкому. Другой коммерческий трек сведён так же, ±2 дБ.
   Убавка стоит после анализатора: волна в переключателе её не замечает. */
const MUSIC_GAIN = 0.25;

export class Ambience {
  private ctx: AudioContext;
  private master: GainNode;
  /** Посетитель ушёл с вкладки — звук стихает, вернулся — возвращается. */
  private awayGain: GainNode;
  private away = false;
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
  /** Щелчки надписей — мимо фильтра комнаты и мимо волны, сразу в колонки. */
  private ui: GainNode;
  /** Итоговая громкость звука мира — после анализатора. */
  private level: GainNode;
  private click: AudioBuffer;
  private lastTick = 0;

  constructor(music?: string) {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.awayGain = ctx.createGain();
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
    this.level = ctx.createGain();
    this.level.gain.value = music ? MUSIC_GAIN : 1;
    this.master.connect(this.awayGain).connect(this.duckGain).connect(this.duckFilter).connect(this.analyser);
    this.analyser.connect(this.level).connect(ctx.destination);
    this.ui = ctx.createGain();
    this.ui.gain.value = TICK_GAIN;
    this.ui.connect(ctx.destination);
    /* Щелчок — как колесо выбора времени в будильнике iPhone (Илья, 2026-10-21:
       «премиальный звук»): не шорох, а чистый короткий «тк» — три затухающих
       тона без шумового хвоста: искра 4 кГц, основной 1,5 кГц и телесный
       750 Гц. Из четырёх на слух Илья выбрал этот, «деревянный»: прежний
       (5,2 / 2,1 / 1,05 кГц) был почти тем, но звонче. Вход за 0,3 мс — без
       ступеньки в колонках. Собирается один раз, дальше только проигрывается. */
    const n = Math.round(ctx.sampleRate * 0.014);
    this.click = ctx.createBuffer(1, n, ctx.sampleRate);
    const c = this.click.getChannelData(0);
    const tone = (t: number, hz: number, tau: number) => Math.sin(2 * Math.PI * hz * t) * Math.exp(-t / tau);
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate;
      c[i] = Math.min(1, t / 0.0003) * (0.3 * tone(t, 4000, 0.0003) + tone(t, 1500, 0.0013) + 0.55 * tone(t, 750, 0.0024));
    }

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
    if (on && !this.away) {
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

  /** Ушли на другую вкладку или свернули окно — звук стихает и встаёт
      на паузу: на фоне звук сайта никому не нужен. Вернулись — поднимается
      с того же места, если был включён. Кривая как у igloo.inc: τ 0,35 с
      в обе стороны, 95% пути за секунду. Пауза — когда уже −40 дБ, чтобы
      обрыв не щёлкнул; у igloo паузы нет, но песня не должна уходить вперёд. */
  setAway(away: boolean) {
    this.away = away;
    const t = this.ctx.currentTime;
    const g = this.awayGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(away ? 0 : 1, t, 0.35);
    if (!this.on) return;
    if (away)
      window.setTimeout(() => {
        if (!this.away) return;
        this.track?.pause();
        void this.ctx.suspend();
      }, 1600);
    else {
      void this.ctx.resume();
      void this.track?.play().catch(() => {});
    }
  }

  /** Щелчок надписи под рукой. Ровный, как у колеса iPhone: высота и громкость
      гуляют едва-едва, на 2% и 8%, — дробь звучит живой, но одним и тем же
      механизмом. Звук выключен или вкладка в фоне — тишина. */
  tick(k = 1) {
    const t = this.ctx.currentTime;
    if (!this.on || this.away || t - this.lastTick < TICK_GAP) return;
    this.lastTick = t;
    const src = this.ctx.createBufferSource();
    src.buffer = this.click;
    src.playbackRate.value = 0.98 + Math.random() * 0.04;
    const g = this.ctx.createGain();
    g.gain.value = k * (0.92 + Math.random() * 0.16);
    src.connect(g).connect(this.ui);
    src.start(t);
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
