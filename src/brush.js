import * as THREE from 'three';
import gsap from 'gsap';

const NOISE = /* glsl */ `
  float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
  }
  float fbm(vec2 p){ float v = 0., a = .5; for(int i = 0; i < 4; i++){ v += a*noise(p); p *= 2.03; a *= .5; } return v; }
`;

const QUAD_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

// Masque de peinture : chaque frame, on dépose des coups de pinceau à poils
// le long du déplacement du curseur, puis la peinture « sèche » lentement.
const MASK_FRAG = /* glsl */ `
  uniform sampler2D tPrev;
  uniform vec4 uSeg[2];       // (ax, ay, bx, by) en uv de scène
  uniform float uRad[2];
  uniform float uOn[2];
  uniform float uAspect;
  uniform float uDecay;
  uniform float uTime;
  varying vec2 vUv;
  ${NOISE}
  float stroke(vec4 seg, float rad){
    vec2 k = vec2(uAspect, 1.);
    vec2 p = vUv * k, a = seg.xy * k, b = seg.zw * k;
    vec2 ab = b - a; float l = length(ab);
    vec2 dir = l > 1e-5 ? ab / l : vec2(1., 0.);
    vec2 nrm = vec2(-dir.y, dir.x);
    float t = clamp(dot(p - a, dir), 0., l);
    float d = length(p - (a + dir * t));
    float across = dot(p - a, nrm) / rad;
    float along = dot(p, dir);
    float bristle = 0.45 + 0.55 * noise(vec2(across * 9.0, along * 3.0));
    bristle *= 0.75 + 0.25 * noise(vec2(across * 31.0, along * 0.5));
    float r = rad * (0.82 + 0.3 * noise(p * 7.0 + uTime));
    return smoothstep(r, r * 0.45, d) * bristle;
  }
  void main(){
    float prev = texture2D(tPrev, vUv).r * uDecay;
    float s = max(stroke(uSeg[0], uRad[0]) * uOn[0], stroke(uSeg[1], uRad[1]) * uOn[1]);
    float m = clamp(max(prev, s) + s * prev * 0.35, 0., 1.);
    gl_FragColor = vec4(m, m, m, 1.);
  }
`;

// Rendu : le dessin préparatoire (sépia, hachures, contours de Sobel) se
// change en peinture à l'huile là où le pinceau est passé.
const VIEW_FRAG = /* glsl */ `
  uniform sampler2D tMask;
  uniform sampler2D tA; uniform float uAspA;
  uniform sampler2D tB; uniform float uAspB;
  uniform float uTrans;
  uniform float uStageAsp;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uFull;
  uniform float uPad;
  varying vec2 vUv;
  ${NOISE}

  vec4 rectFor(float asp){
    float avW = 1. - 2. * uPad * 0.6, avH = 1. - 2. * uPad;
    float h = avH, w = h * asp / uStageAsp;
    if (w > avW){ w = avW; h = w * uStageAsp / asp; }
    return vec4(0.5 - w * 0.5, 0.5 - h * 0.5, w, h);
  }
  float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec4 paint(sampler2D tex, float asp, float m, vec2 g){
    vec4 r = rectFor(asp);
    vec2 local = (vUv - r.xy) / r.zw;
    vec2 o = max(max(r.xy - vUv, vUv - (r.xy + r.zw)), 0.) * uRes;
    float out_ = length(o);
    if (out_ > 0.){
      float fw = 12.0 * (uRes.y / 900.);
      if (out_ < fw){
        float t = out_ / fw;
        vec3 gold = mix(vec3(0.86, 0.69, 0.38), vec3(0.36, 0.25, 0.11), t);
        gold *= 0.78 + 0.32 * sin(t * 10.0) + 0.1 * noise(vUv * uRes * 0.15);
        return vec4(gold, 1.);
      }
      return vec4(0., 0., 0., exp(-(out_ - fw) / (uRes.y * 0.04)) * 0.55);
    }

    vec2 px = 1. / (r.zw * uRes);
    vec3 col0 = texture2D(tex, local).rgb;
    vec3 col = texture2D(tex, local - g * 0.012).rgb;

    float s = 1.6;
    float tl = lum(texture2D(tex, local + px * vec2(-s,  s)).rgb);
    float tc = lum(texture2D(tex, local + px * vec2( 0,  s)).rgb);
    float tr = lum(texture2D(tex, local + px * vec2( s,  s)).rgb);
    float ml = lum(texture2D(tex, local + px * vec2(-s,  0)).rgb);
    float mr = lum(texture2D(tex, local + px * vec2( s,  0)).rgb);
    float bl = lum(texture2D(tex, local + px * vec2(-s, -s)).rgb);
    float bc = lum(texture2D(tex, local + px * vec2( 0, -s)).rgb);
    float br = lum(texture2D(tex, local + px * vec2( s, -s)).rgb);
    float gx = -tl - 2.*ml - bl + tr + 2.*mr + br;
    float gy = -bl - 2.*bc - br + tl + 2.*tc + tr;
    float edge = smoothstep(0.08, 0.5, length(vec2(gx, gy)));

    float L = lum(col0);
    float dark = 1. - L;
    vec2 pp = local * vec2(asp, 1.);
    vec3 paper = vec3(0.93, 0.89, 0.81) * (0.93 + 0.07 * fbm(pp * 80.));
    vec3 wash = vec3(0.62, 0.50, 0.37);
    vec3 ink = vec3(0.18, 0.12, 0.08);
    vec2 fc = gl_FragCoord.xy;
    float h1 = smoothstep(0.6, 0.95, 0.5 + 0.5 * sin((fc.x + fc.y) * 0.5 + noise(fc * 0.05) * 2.0));
    float h2 = smoothstep(0.6, 0.95, 0.5 + 0.5 * sin((fc.x - fc.y) * 0.5 + noise(fc * 0.04) * 2.0));
    float hatch = h1 * smoothstep(0.3, 0.6, dark) + h2 * smoothstep(0.55, 0.85, dark);
    vec3 sketch = mix(paper, wash, smoothstep(0.2, 1.0, dark) * 0.45);
    sketch = mix(sketch, ink, clamp(hatch * 0.5 + edge * 0.8, 0., 1.));

    float n = fbm(pp * 7. + uTime * 0.03);
    float rv = smoothstep(0.3, 0.5, m + (n - 0.5) * 0.4);
    rv = max(rv, smoothstep(0.0, 1.0, uFull * 1.6 - n * 0.6));

    vec3 N = normalize(vec3(-g * 2.2, 1.));
    float spec = pow(max(dot(N, normalize(vec3(-0.5, 0.6, 0.65))), 0.), 24.);
    float rim = smoothstep(0.25, 0.42, m) * (1. - smoothstep(0.42, 0.7, m));
    float ridges = noise(vec2(dot(pp, vec2(0.7, 0.7)) * 140., 0.)) * 0.06;
    vec3 painted = col * (1. - rim * 0.22 + ridges * (1. - uFull)) + spec * 0.22 * (1. - uFull);
    return vec4(mix(sketch, painted, rv), 1.);
  }

  void main(){
    vec2 d = 2.5 / uRes;
    float m = texture2D(tMask, vUv).r;
    vec2 g = vec2(
      texture2D(tMask, vUv + vec2(d.x, 0.)).r - texture2D(tMask, vUv - vec2(d.x, 0.)).r,
      texture2D(tMask, vUv + vec2(0., d.y)).r - texture2D(tMask, vUv - vec2(0., d.y)).r
    );

    vec4 c;
    if (uTrans <= 0.0) c = paint(tA, uAspA, m, g);
    else if (uTrans >= 1.0) c = paint(tB, uAspB, m, g);
    else {
      // changement d'œuvre : grands coups de brosse horizontaux
      float band = floor(vUv.y * 7.);
      float delay = hash(vec2(band, 3.7)) * 0.4;
      float e = uTrans * 1.8 - delay + (fbm(vec2(vUv.y * 40., band)) - 0.5) * 0.15;
      float w = smoothstep(e + 0.015, e - 0.015, vUv.x);
      c = mix(paint(tA, uAspA, m, g), paint(tB, uAspB, m, g), w);
    }
    gl_FragColor = vec4(c.rgb * c.a, c.a);
  }
`;

export class BrushStage {
  constructor(canvas, images) {
    this.canvas = canvas;
    this.images = images;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, premultipliedAlpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.textures = {};
    this.visible = false;
    this.pointer = null;
    this.prev = null;
    this.auto = { on: 0, a: new THREE.Vector2(), b: new THREE.Vector2() };
    this.time = 0;

    const quad = new THREE.PlaneGeometry(2, 2);
    this.maskMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: MASK_FRAG,
      uniforms: {
        tPrev: { value: null },
        uSeg: { value: [new THREE.Vector4(), new THREE.Vector4()] },
        uRad: { value: [0.08, 0.08] },
        uOn: { value: [0, 0] },
        uAspect: { value: 1 },
        uDecay: { value: 0.997 },
        uTime: { value: 0 },
      },
    });
    this.maskScene = new THREE.Scene();
    this.maskScene.add(new THREE.Mesh(quad, this.maskMat));

    this.viewMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: VIEW_FRAG,
      transparent: true,
      uniforms: {
        tMask: { value: null },
        tA: { value: null },
        uAspA: { value: 1 },
        tB: { value: null },
        uAspB: { value: 1 },
        uTrans: { value: 0 },
        uStageAsp: { value: 1 },
        uRes: { value: new THREE.Vector2() },
        uTime: { value: 0 },
        uFull: { value: 0 },
        uPad: { value: 0.08 },
      },
    });
    this.viewScene = new THREE.Scene();
    this.viewScene.add(new THREE.Mesh(quad, this.viewMat));

    this.resize();
    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.pointer = new THREE.Vector2((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.prev = null;
    });
    new IntersectionObserver(([e]) => (this.visible = e.isIntersecting)).observe(canvas);
  }

  tex(id) {
    if (!this.textures[id]) {
      const t = new THREE.Texture(this.images[id]);
      t.colorSpace = THREE.NoColorSpace; // on garde les valeurs sRGB brutes
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.needsUpdate = true;
      this.textures[id] = t;
    }
    return this.textures[id];
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA?.dispose();
    this.rtB?.dispose();
    this.rtA = new THREE.WebGLRenderTarget(Math.ceil((w * pr) / 2), Math.ceil((h * pr) / 2), opts);
    this.rtB = this.rtA.clone();
    this.viewMat.uniforms.uRes.value.set(w * pr, h * pr);
    this.viewMat.uniforms.uStageAsp.value = w / h;
    this.viewMat.uniforms.uPad.value = w < 700 ? 0.04 : 0.08;
    this.maskMat.uniforms.uAspect.value = w / h;
  }

  aspect(id) {
    const im = this.images[id];
    return im.width / im.height;
  }

  // Changement d'œuvre avec un balayage à la brosse.
  show(id, instant = false) {
    const u = this.viewMat.uniforms;
    if (!u.tA.value || instant) {
      u.tA.value = this.tex(id);
      u.uAspA.value = this.aspect(id);
      this.current = id;
      return;
    }
    if (id === this.current) return;
    this.tween?.progress(1).kill();
    this.current = id;
    u.tB.value = this.tex(id);
    u.uAspB.value = this.aspect(id);
    u.uTrans.value = 0;
    gsap.to(u.uFull, { value: 0, duration: 0.6, ease: 'power2.out' });
    gsap.fromTo(this.maskMat.uniforms.uDecay, { value: 0.9 }, { value: 0.997, duration: 1.2, ease: 'expo.in' });
    this.tween = gsap.to(u.uTrans, {
      value: 1,
      duration: 1.5,
      ease: 'power2.inOut',
      onComplete: () => {
        u.tA.value = u.tB.value;
        u.uAspA.value = u.uAspB.value;
        u.uTrans.value = 0;
        this.autoStroke(0.4);
      },
    });
  }

  // Rectangle (px CSS) où le shader dessine l'œuvre — même calcul que rectFor().
  paintingRect(id) {
    const r = this.canvas.getBoundingClientRect();
    const sa = r.width / r.height;
    const asp = this.aspect(id);
    const pad = this.viewMat.uniforms.uPad.value;
    let h = 1 - 2 * pad;
    let w = (h * asp) / sa;
    if (w > 1 - 2 * pad * 0.6) {
      w = 1 - 2 * pad * 0.6;
      h = (w * sa) / asp;
    }
    return { x: r.left + (0.5 - w / 2) * r.width, y: r.top + (0.5 - h / 2) * r.height, w: w * r.width, h: h * r.height, frame: (12 * r.height) / 900 };
  }

  // L'œuvre arrive en couleurs puis retourne à l'esquisse, comme une peinture qui se défait.
  dissolve(onDone) {
    this.dissolveTween?.kill();
    const u = this.viewMat.uniforms.uFull;
    u.value = 1;
    this.dissolveTween = gsap.to(u, { value: 0, duration: 2.6, delay: 0.35, ease: 'power2.inOut', onComplete: onDone });
  }

  holdColor() {
    this.dissolveTween?.kill();
    this.viewMat.uniforms.uFull.value = 1;
  }

  setFull(on) {
    gsap.to(this.viewMat.uniforms.uFull, { value: on ? 1 : 0, duration: on ? 2.2 : 0.9, ease: on ? 'power2.inOut' : 'power2.out' });
  }

  // Un coup de pinceau automatique pour montrer que l'on peut peindre.
  autoStroke(delay = 0) {
    const s = { t: 0 };
    const y0 = 0.35 + Math.random() * 0.3;
    const path = (t, out) => out.set(0.3 + t * 0.4, y0 + Math.sin(t * Math.PI * 1.6) * 0.12);
    let last = path(0, new THREE.Vector2());
    gsap.to(s, {
      t: 1,
      duration: 1.1,
      delay,
      ease: 'power1.inOut',
      onUpdate: () => {
        this.auto.a.copy(last);
        path(s.t, this.auto.b);
        last = this.auto.b.clone();
        this.auto.on = 1;
      },
      onComplete: () => (this.auto.on = 0),
    });
  }

  update(dt) {
    if (!this.visible || !this.viewMat.uniforms.tA.value) return;
    this.time += dt;
    const mu = this.maskMat.uniforms;
    mu.uTime.value = this.time;

    if (this.pointer && this.prev) {
      const speed = this.pointer.distanceTo(this.prev) / Math.max(dt, 1e-3);
      mu.uSeg.value[0].set(this.prev.x, this.prev.y, this.pointer.x, this.pointer.y);
      mu.uRad.value[0] = 0.07 + Math.min(speed * 0.02, 0.05);
      mu.uOn.value[0] = this.pointer.equals(this.prev) ? 0 : 1;
    } else mu.uOn.value[0] = 0;
    this.prev = this.pointer ? this.pointer.clone() : null;

    mu.uSeg.value[1].set(this.auto.a.x, this.auto.a.y, this.auto.b.x, this.auto.b.y);
    mu.uRad.value[1] = 0.09;
    mu.uOn.value[1] = this.auto.on;

    mu.tPrev.value = this.rtA.texture;
    this.renderer.setRenderTarget(this.rtB);
    this.renderer.render(this.maskScene, this.camera);
    [this.rtA, this.rtB] = [this.rtB, this.rtA];

    const vu = this.viewMat.uniforms;
    vu.tMask.value = this.rtA.texture;
    vu.uTime.value = this.time;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.viewScene, this.camera);
  }
}
