/**
 * Звук мира: ветер и низкий гул, собранные прямо в браузере.
 *
 * Ни одного аудиофайла — вес сайта не растёт. Включается только по нажатию:
 * браузер не даёт звуку начаться самому, и это правильно. Рука раздувает
 * ветер, пролёт по кругу делает его выше и громче.
 */
export class Ambience {
  private ctx: AudioContext;
  private master: GainNode;
  private windGain: GainNode;
  private windFilter: BiquadFilterNode;
  private on = false;

  constructor() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // Ветер: белый шум через полосовой фильтр. Буфер на две секунды по кругу —
    // на слух шум не повторяется.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 380;
    this.windFilter.Q.value = 0.8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.16;
    noise.connect(this.windFilter).connect(this.windGain).connect(this.master);
    noise.start();

    // Дыхание ветра: медленная волна по частоте фильтра, раз в четырнадцать секунд.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 140;
    lfo.connect(depth).connect(this.windFilter.frequency);
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
    if (on) void this.ctx.resume();
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, t, on ? 0.6 : 0.25);
    // Выключенный звук не держит аудиопоток открытым. Проверка флага — на случай,
    // если звук включили обратно раньше, чем истекла пауза.
    if (!on) window.setTimeout(() => !this.on && void this.ctx.suspend(), 1500);
  }

  /** Несколько раз в секунду: рука и пролёт, оба от 0 до 1. */
  drive(hand: number, flight: number) {
    if (!this.on) return;
    const t = this.ctx.currentTime;
    const energy = Math.min(1, hand * 0.8 + flight * 0.9);
    this.windFilter.frequency.setTargetAtTime(380 + energy * 900, t, 0.25);
    this.windGain.gain.setTargetAtTime(0.16 + energy * 0.34, t, 0.2);
  }

  close() {
    void this.ctx.close();
  }
}
