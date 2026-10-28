// Curseur + traînée de peinture dorée à poils de pinceau.
export class Cursor {
  constructor(root, canvas) {
    this.root = root;
    this.dot = root.querySelector('.cursor__dot');
    this.ring = root.querySelector('.cursor__ring');
    this.label = root.querySelector('.cursor__label');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pos = { x: innerWidth / 2, y: innerHeight / 2 };
    this.ringPos = { ...this.pos };
    this.points = [];
    this.trail = true;
    this.bristles = Array.from({ length: 11 }, (_, i) => ({
      off: (i / 10 - 0.5) * 2 + (Math.random() - 0.5) * 0.25,
      w: 0.6 + Math.random() * 1.8,
      a: 0.25 + Math.random() * 0.75,
      tone: Math.random(),
    }));

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.pos.x = e.clientX;
      this.pos.y = e.clientY;
      this.root.classList.add('is-on');
      if (this.trail) this.points.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    });
    document.addEventListener('pointerleave', () => this.root.classList.remove('is-on'));
    document.addEventListener('pointerover', (e) => {
      const el = e.target.closest('[data-cursor]');
      this.setState(el ? el.dataset.cursor : '', el?.dataset.cursorLabel || '');
    });
  }

  setState(state, label) {
    this.root.dataset.state = state;
    this.label.textContent = label;
    this.trail = state !== 'paint';
  }

  resize() {
    const pr = Math.min(devicePixelRatio, 2);
    this.canvas.width = innerWidth * pr;
    this.canvas.height = innerHeight * pr;
    this.ctx.setTransform(pr, 0, 0, pr, 0, 0);
  }

  update() {
    this.ringPos.x += (this.pos.x - this.ringPos.x) * 0.18;
    this.ringPos.y += (this.pos.y - this.ringPos.y) * 0.18;
    this.dot.style.transform = `translate3d(${this.pos.x}px, ${this.pos.y}px, 0)`;
    this.ring.style.transform = `translate3d(${this.ringPos.x}px, ${this.ringPos.y}px, 0)`;

    const now = performance.now();
    const life = 700;
    this.points = this.points.filter((p) => now - p.t < life);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const pts = this.points;
    if (pts.length < 3) return;

    ctx.lineCap = 'round';
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const c = pts[i + 1];
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const age = (now - b.t) / life;
      const speed = Math.min(len / 30, 1);
      const spread = 3 + speed * 9 * (1 - age);
      for (const br of this.bristles) {
        const o = br.off * spread;
        ctx.strokeStyle = `rgba(${200 + br.tone * 40},${158 + br.tone * 40},${86 + br.tone * 40},${(1 - age) * br.a * 0.85})`;
        ctx.lineWidth = br.w * (1 - age * 0.6);
        ctx.beginPath();
        ctx.moveTo(a.x + nx * o, a.y + ny * o);
        ctx.quadraticCurveTo(b.x + nx * o, b.y + ny * o, (b.x + c.x) / 2 + nx * o, (b.y + c.y) / 2 + ny * o);
        ctx.stroke();
      }
    }
  }
}
