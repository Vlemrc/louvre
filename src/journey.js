import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

// Demi-base et hauteur de la pyramide (proportions réelles : 35,4 m × 21,6 m).
const B = 10;
const H = 12.2;
// Sous-sol : Hall Napoléon puis Grande Galerie.
const FLOOR = -16;
const WALL_TOP = -6;
const HALL = 26;
// Pyramide inversée, suspendue dans le hall
const INV = new THREE.Vector3(16, -0.3, -15);
const GAL_W = 6;
const GAL_END = -152;

const NOISE = /* glsl */ `
  float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
  }
`;

// Trajectoire caméra : [position, cible]
const KEYS = [
  [0, 2.2, 98, 0, 7.5, 0],
  [10, 3.6, 64, 0, 7, 0],
  [-5, 5.2, 34, 0, 6.5, 0],
  [0, 5.6, 15, 0, 5.2, 0],
  [0, 3.6, 2.5, 0, -14, -1.5],
  [-6.5, -5, 8, 12, -9, -12],
  [6, -9.5, 5, 16, -9.6, -15],
  [3, -10.5, -14, 0, -10.5, -45],
  [0, -10.5, -34, 0, -10.5, -70],
  [0, -10.5, -70, 0, -10.4, -110],
  [0, -10.5, -108, 0, -10.4, -140],
  [0, -10.4, -143.5, 0, -11.0, -152],
];

export class Journey {
  constructor(canvas, images, corridorList, joconde) {
    this.canvas = canvas;
    this.images = images;
    this.progress = 0;
    this.target = 0;
    this.intro = 0;
    this.mouse = new THREE.Vector2(0, 0);
    this.smoothMouse = new THREE.Vector2(0, 0);
    this.hovered = null;
    this.onHover = () => {};
    this.active = true;
    this.clock = new THREE.Clock();

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }));
    this.dpr = Math.min(window.devicePixelRatio, 1.5);
    r.setPixelRatio(this.dpr);
    r.setSize(innerWidth, innerHeight, false);
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05070c, 0.0055);
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1400);

    const pmrem = new THREE.PMREMGenerator(r);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    RectAreaLightUniformsLib.init();

    this.posCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(k[0], k[1], k[2])), false, 'centripetal');
    this.lookCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(k[3], k[4], k[5])), false, 'centripetal');

    this.updatables = [];
    this.paintingMeshes = [];

    this.buildSky();
    this.buildCourtyard();
    this.buildPyramid();
    this.buildPalace();
    this.buildHall();
    this.buildGallery(corridorList, joconde);
    this.buildLights();
    this.buildPost();

    this.raycaster = new THREE.Raycaster();
    window.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      this.pointer = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('resize', () => this.resize());
  }

  /* ---------- Ciel de Paris ---------- */
  buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(600, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: /* glsl */ `
          varying vec3 vDir;
          void main(){
            float h = vDir.y;
            vec3 zen = vec3(0.004,0.007,0.02);
            vec3 hor = vec3(0.05,0.06,0.10);
            vec3 c = mix(hor, zen, smoothstep(0.0, 0.55, h));
            c += vec3(0.28,0.14,0.06) * exp(-max(h,0.0)*12.0) * 0.55; // halo de la ville
            gl_FragColor = vec4(c, 1.0);
          }`,
      })
    );
    sky.renderOrder = -2;
    this.sky = sky;
    this.scene.add(sky);

    const N = 2200;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(1 - Math.random() * 0.95);
      pos.set([Math.sin(v) * Math.cos(u) * 520, Math.cos(v) * 520, Math.sin(v) * Math.sin(u) * 520], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false })
    );
    this.stars.renderOrder = -1;
    this.scene.add(this.stars);

    this.moon = new THREE.Mesh(new THREE.CircleGeometry(4.5, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.35), fog: false }));
    this.moonOffset = new THREE.Vector3(-170, 190, -360);
    this.scene.add(this.moon);
  }

  /* ---------- Cour Napoléon ---------- */
  buildCourtyard() {
    const tri = (pts) => new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const pools = [
      tri([[-34, 13], [-3.5, 13], [-3.5, 43]]),
      tri([[3.5, 13], [34, 13], [3.5, 43]]),
      tri([[-44, 9], [-15, 9], [-44, -22]]),
      tri([[15, 9], [44, 9], [44, -22]]),
    ];

    const outer = new THREE.Shape([new THREE.Vector2(-400, -400), new THREE.Vector2(400, -400), new THREE.Vector2(400, 400), new THREE.Vector2(-400, 400)]);
    const square = (s) => new THREE.Path([new THREE.Vector2(-s, -s), new THREE.Vector2(s, -s), new THREE.Vector2(s, s), new THREE.Vector2(-s, s)]);
    outer.holes.push(square(B));
    pools.forEach((p) => outer.holes.push(new THREE.Path(p.getPoints())));

    const ground = new THREE.Mesh(
      new THREE.ShapeGeometry(outer),
      new THREE.MeshStandardMaterial({ map: pavingTexture(), roughness: 0.5, metalness: 0, envMap: this.env, envMapIntensity: 0.15 })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // Bassins : vrais miroirs d'eau légèrement ridés
    const water = new Reflector(new THREE.ShapeGeometry(pools), {
      textureWidth: innerWidth * this.dpr * 0.5,
      textureHeight: innerHeight * this.dpr * 0.5,
      color: 0x8d949e,
      clipBias: 0.003,
      shader: WaterShader,
    });
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.03;
    this.water = water;
    this.scene.add(water);

    // Margelles
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x6e6658, roughness: 0.6 });
    pools.forEach((p) => {
      const pts = p.getPoints();
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (a.equals(b)) continue;
        this.scene.add(beam(new THREE.Vector3(a.x, 0.12, -a.y), new THREE.Vector3(b.x, 0.12, -b.y), 0.22, rimMat, 4));
      }
    });
  }

  /* ---------- La Pyramide de Pei ---------- */
  buildPyramid() {
    this.glass = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uRows: { value: 18 } }]),
      vertexShader: /* glsl */ `
        attribute vec3 bary;
        varying vec3 vBary; varying vec3 vW; varying vec3 vN;
        #include <fog_pars_vertex>
        void main(){
          vBary = bary;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uRows;
        varying vec3 vBary; varying vec3 vW; varying vec3 vN;
        #include <fog_pars_fragment>
        ${NOISE}
        float grid(float x){
          float g = x * uRows;
          float d = abs(fract(g + 0.5) - 0.5);
          return 1.0 - smoothstep(0.0, fwidth(g) * 1.4, d);
        }
        void main(){
          float lines = max(grid(vBary.x), grid(vBary.y));
          float e = min(min(vBary.x, vBary.y), vBary.z);
          float edge = 1.0 - smoothstep(0.0, fwidth(e) * 3.5, e);
          lines = max(lines, edge);

          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - abs(dot(V, normalize(vN))), 3.0);
          float low = 1.0 - vBary.z;               // plus lumineux vers la base
          vec3 warm = vec3(1.0, 0.68, 0.36);

          // reflets mouvants dans les losanges
          float sheen = smoothstep(0.62, 1.0, noise(vec2(vW.x + vW.z, vW.y * 1.7) * 0.18 + uTime * 0.05));
          vec3 glass = vec3(0.05, 0.09, 0.15) + warm * 0.10 * low + vec3(0.45, 0.55, 0.75) * fres * 0.7 + sheen * 0.08;
          vec3 steel = mix(vec3(0.3, 0.29, 0.28), warm * 1.5, 0.25 + 0.75 * low * low);

          vec3 col = mix(glass, steel, lines);
          float alpha = mix(0.16 + fres * 0.45 + sheen * 0.1, 0.92, lines);
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }`,
    });

    const make = (b, h, x, z) => {
      const m = new THREE.Mesh(pyramidGeometry(b, h), this.glass);
      m.position.set(x, 0, z);
      m.renderOrder = 2;
      this.scene.add(m);
    };
    make(B, H, 0, 0);
    // les trois pyramidions
    make(2.4, 2.9, -19, -1);
    make(2.4, 2.9, 19, -1);
    make(2.4, 2.9, 0, -19);

    // poutres d'arêtes
    const steel = new THREE.MeshStandardMaterial({ color: 0x9a948c, metalness: 0.9, roughness: 0.35, envMap: this.env, emissive: 0x3a2410 });
    const apex = new THREE.Vector3(0, H, 0);
    const c = [
      [-B, B],
      [B, B],
      [B, -B],
      [-B, -B],
    ].map(([x, z]) => new THREE.Vector3(x, 0, z));
    c.forEach((p, i) => {
      this.scene.add(beam(p, apex, 0.09, steel));
      this.scene.add(beam(p, c[(i + 1) % 4], 0.14, steel));
    });

    // dalle de verre du hall qui irradie sous la pyramide
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * B, 2 * B),
      new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,200,140,0.55)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = FLOOR + 0.05;
    this.scene.add(this.glow);

    // poussière dorée autour de la pyramide
    this.scene.add(this.dust(500, [-30, 0.5, -25], [30, 18, 30], 0xffd59a, 7));
  }

  /* ---------- Le palais ---------- */
  buildPalace() {
    const vert = /* glsl */ `
      varying vec3 vW; varying vec3 vN; varying float vL;
      #include <fog_pars_vertex>
      void main(){
        vL = position.y;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`;

    // Élévation de la cour Napoléon : arcades, pilastres jumelés, frontons,
    // corniches, balustrade — le tout éclairé en contre-plongée.
    const facade = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      vertexShader: vert,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vW; varying vec3 vN;
        #include <fog_pars_fragment>
        ${NOISE}
        float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.07; a *= .5; } return v; }

        // fenêtre : rectangle (+ plein cintre) ; p relatif au bas-centre
        float sdWin(vec2 p, float w, float h, float arch){
          vec2 d = abs(p - vec2(0., h * .5)) - vec2(w, h * .5);
          float r = length(max(d, 0.)) + min(max(d.x, d.y), 0.);
          if (arch > .5) r = min(r, max(length(p - vec2(0., h)) - w, h - p.y));
          return r;
        }
        float pediment(vec2 q, float kind){
          float tri = step(0., q.y) * step(q.y, .95 - abs(q.x) * .8) * step(abs(q.x), 1.2);
          float seg = step(0., q.y) * step(length(q - vec2(0., -1.6)), 2.35) * step(abs(q.x), 1.15);
          return kind < .5 ? tri : seg;
        }
        // corniche : x = moulure éclairée par-dessous, y = ombre portée au-dessus
        vec2 cornice(float y, float c){
          float t = (y - c) / .5;
          float lit = step(0., t) * step(t, 1.) * (.25 + .55 * (1. - t));
          float sh = step(1., t) * (1. - smoothstep(1., 1.9, t));
          return vec2(lit, sh);
        }

        void main(){
          vec3 n = normalize(vN);
          float hx = abs(n.x) > .5 ? vW.z : vW.x;
          float y = vW.y;

          // pierre de taille : grain, coulures, joints
          float n1 = fbm(vec2(hx, y) * .55);
          float streak = noise(vec2(hx * 3., y * .16));
          vec3 stone = vec3(.66, .58, .46) * (.84 + .32 * n1);
          stone *= 1. - .2 * smoothstep(.55, .95, streak);

          vec3 upCol = vec3(1.1, .76, .44);
          if (n.y < -.5){ gl_FragColor = vec4(stone * upCol * .85, 1.); 
            #include <fog_fragment>
            return; }
          if (n.y > .5){ gl_FragColor = vec4(stone * .1, 1.);
            #include <fog_fragment>
            return; }

          float row = floor(y / .62);
          float jy = abs(fract(y / .62) - .5);
          float jx = abs(fract(hx / 1.35 + mod(row, 2.) * .5) - .5);
          stone *= 1. - .22 * max(smoothstep(.43, .5, jy), smoothstep(.48, .5, jx));

          float bayW = 4.2;
          float bi = floor(hx / bayW);
          float bx = (fract(hx / bayW) - .5) * bayW;
          float faceId = dot(n, vec3(1., 2., 3.));

          // projecteurs au pied des pilastres + clair de lune
          float pool = exp(-pow(abs(bx) - 1.85, 2.) * .8);
          float up = exp(-max(y, 0.) * .07) * (.35 + .8 * pool) + exp(-max(y, 0.) * .35) * .35;
          vec3 light = vec3(.05, .06, .09) + upCol * up;
          float relief = 1.;

          // pilastres jumelés
          float pu = abs(bx) - 1.42;
          if (pu > 0. && y < 18.2){
            float c = fract(pu / .34);
            relief *= .78 + .5 * sin(c * 3.14159);
          }

          // niveaux
          float lvl = -1.; float win = 1e3; vec2 wp = vec2(0.);
          if (y < 6.8){ lvl = 0.; wp = vec2(bx, y - .3); win = sdWin(wp, 1.15, 4.5, 1.); }
          else if (y < 13.4){ lvl = 1.; wp = vec2(bx, y - 7.9); win = sdWin(wp, .72, 3.7, 0.); }
          else if (y < 18.2){ lvl = 2.; wp = vec2(bx, y - 14.4); win = sdWin(wp, .6, 2.5, 0.); }
          else if (y > 20.6){ float k = floor((y - 20.6) / 4.8); lvl = 3. + k; wp = vec2(bx, mod(y - 20.6, 4.8) - .9); win = sdWin(wp, .6, 2.5, mod(k, 2.)); }

          // chambranles
          float frameM = step(0., win) * step(win, .2);
          relief *= 1. + frameM * .22;
          relief *= 1. - step(.2, win) * step(win, .27) * .25;

          // frontons alternés au bel étage, avec ombre portée vers le haut
          if (lvl == 1.){
            vec2 q = vec2(bx, y - 11.85);
            float kind = mod(bi, 2.);
            float ped = pediment(q, kind);
            float pedSh = pediment(q - vec2(0., .35), kind) * (1. - ped);
            relief *= (1. + ped * .35) * (1. - pedSh * .5);
          }

          // corniches de niveau
          vec2 c0 = cornice(y, 6.6), c1 = cornice(y, 13.2), c2 = cornice(y, 17.9);
          vec2 cc = c0 + c1 + c2;
          if (y > 20.4){ cc += cornice(mod(y - 20.4, 4.8) + 20.4, 20.4); }
          relief *= (1. + cc.x * .6) * (1. - cc.y * .45);

          vec3 col = stone * light * relief;

          // frise et denticules
          if (y > 18.4 && y < 18.9){
            float dent = step(.5, fract(hx * 3.)) * step(18.7, y);
            col *= .75 + dent * .35;
          }
          // balustrade
          if (y > 18.9 && y < 20.){
            float t = (y - 19.05) / .8;
            float rail = step(y, 19.05) + step(19.85, y);
            float bw = .05 + .07 * sin(clamp(t, 0., 1.) * 3.14159);
            float bal = step(abs(fract(hx / .38) - .5) * .38, bw);
            float solid = max(rail, bal);
            col = mix(vec3(.012, .014, .024), stone * light * (rail > 0. ? 1.2 : 1. + .3 * sin(t * 3.14)), solid);
          }

          // vitrages : embrasure, meneaux, lumière intérieure ou reflet du ciel
          if (win < 0.){
            float depth = smoothstep(0., -.22, win);
            float on = step(lvl < .5 ? .25 : .5, hash(vec2(bi, lvl) + faceId * 13.1));
            float mull = max(1. - smoothstep(.02, .05, abs(wp.x)), 1. - smoothstep(.02, .05, abs(fract(wp.y / 1.1 + .5) - .5) * 1.1));
            vec3 warm = vec3(1.55, .98, .46) * (.5 + .5 * hash(vec2(bi * 3.1, lvl))) * (.75 + .25 * smoothstep(0., 3., wp.y));
            vec3 dark = mix(vec3(.008, .01, .018), vec3(.045, .055, .085), smoothstep(0., 4., wp.y));
            vec3 glass = mix(dark, warm, on) * (1. - mull * .85);
            vec3 reveal = stone * light * .38;
            col = mix(reveal, glass, depth);
          }

          gl_FragColor = vec4(col, 1.);
          #include <fog_fragment>
        }`,
    });
    this.facade = facade;

    // Toit mansardé : ardoise, lucarnes à fronton, faîtage en zinc.
    const roofMats = {};
    const roofMat = (roofH) =>
      (roofMats[roofH] ??= new THREE.ShaderMaterial({
        fog: true,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uRoofH: { value: roofH } }]),
        vertexShader: vert,
        fragmentShader: /* glsl */ `
          uniform float uRoofH;
          varying vec3 vW; varying vec3 vN; varying float vL;
          #include <fog_pars_fragment>
          ${NOISE}
          void main(){
            vec3 n = normalize(vN);
            float t = vL / uRoofH + .5;
            float hx = abs(n.x) > abs(n.z) ? vW.z : vW.x;
            vec3 slate = vec3(.085, .1, .125) * (.85 + .3 * noise(vec2(hx * 5., vW.y * 3.4)));
            float rows = abs(fract(vW.y * 3.4) - .5);
            float cols = abs(fract(hx * 2.2 + floor(vW.y * 3.4) * .5) - .5);
            slate *= 1. - .3 * max(smoothstep(.4, .5, rows), smoothstep(.46, .5, cols));
            slate += vec3(.05, .065, .1) * pow(t, 2.);                // reflet du ciel
            slate += vec3(.3, .19, .09) * exp(-t * 5.) * .7;           // halo des projecteurs
            vec3 col = slate;
            if (n.y > .97) col = slate * .55;
            else {
              float bx = (fract(hx / 4.2) - .5) * 4.2;
              float bi = floor(hx / 4.2);
              vec2 q = vec2(bx, vL + uRoofH * .5 - .8);
              float body = step(abs(q.x), .72) * step(0., q.y) * step(q.y, 2.);
              float ped = step(2., q.y) * step(q.y, 2.75 - abs(q.x) * .85) * step(abs(q.x), .88);
              float gl = step(abs(q.x), .42) * step(.25, q.y) * step(q.y, 1.75);
              float on = step(.6, hash(vec2(bi, dot(n, vec3(7., 1., 3.)))));
              vec3 stoneC = vec3(.6, .52, .4) * (.12 + exp(-t * 2.5) * .55);
              vec3 g = mix(vec3(.015, .02, .035), vec3(1.4, .88, .42), on);
              g *= 1. - (1. - smoothstep(.02, .05, abs(q.x))) * .8;
              col = mix(col, stoneC, max(body, ped));
              col = mix(col, g, gl);
              col += vec3(.5, .5, .55) * smoothstep(.96, 1., t) * .25;   // faîtage
            }
            gl_FragColor = vec4(col, 1.);
            #include <fog_fragment>
          }`,
      }));

    const block = (x, z, w, h, d, roofH, inset) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), facade);
      m.position.set(x, h / 2, z);
      this.scene.add(m);
      // corniche saillante (silhouette) au niveau de l'entablement
      const c = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, 0.7, d + 0.7), facade);
      c.position.set(x, 18.55, z);
      this.scene.add(c);
      if (h > 20) {
        const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.6, d + 0.8), facade);
        top.position.set(x, h - 0.3, z);
        this.scene.add(top);
      }
      const rg = new THREE.BoxGeometry(w, roofH, d);
      const p = rg.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > 0) {
          p.setX(i, Math.sign(p.getX(i)) * Math.max(Math.abs(p.getX(i)) - inset, 0.3));
          p.setZ(i, Math.sign(p.getZ(i)) * Math.max(Math.abs(p.getZ(i)) - inset, 0.3));
        }
      }
      rg.computeVertexNormals();
      const rm = new THREE.Mesh(rg, roofMat(roofH));
      rm.position.set(x, h + roofH / 2, z);
      this.scene.add(rm);
    };

    // ailes Sully, Richelieu, Denon
    block(0, -62, 150, 20, 18, 6, 3.5);
    block(-66, 8, 18, 20, 140, 6, 3.5);
    block(66, 8, 18, 20, 140, 6, 3.5);
    // Pavillon de l'Horloge et pavillons d'angle
    block(0, -62, 22, 30, 22, 12, 7);
    block(-66, -62, 26, 25, 26, 8, 6);
    block(66, -62, 26, 25, 26, 8, 6);
    block(-66, 78, 24, 24, 24, 8, 6);
    block(66, 78, 24, 24, 24, 8, 6);
    block(-66, 10, 22, 24, 22, 8, 6);
    block(66, 10, 22, 24, 22, 8, 6);

    // lampadaires de la cour
    const pole = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, metalness: 0.8, roughness: 0.4, envMap: this.env });
    const bulb = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.7, 0.95) });
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 4.2, 8);
    const bulbGeo = new THREE.SphereGeometry(0.26, 16, 12);
    [-50, -28, 28, 50].forEach((x) =>
      [48, 22, -8, -34].forEach((z) => {
        const g = new THREE.Group();
        const pm = new THREE.Mesh(poleGeo, pole);
        pm.position.y = 2.1;
        const b = new THREE.Mesh(bulbGeo, bulb);
        b.position.y = 4.35;
        g.add(pm, b);
        g.position.set(x, 0, z);
        this.scene.add(g);
      })
    );
  }

  /* ---------- Hall Napoléon & escalier hélicoïdal ---------- */
  buildHall() {
    const stone = new THREE.MeshStandardMaterial({ color: 0xa89574, roughness: 0.85, envMap: this.env, envMapIntensity: 0.12 });
    const blocks = new THREE.MeshStandardMaterial({ map: blockTexture(), roughness: 0.8, envMap: this.env, envMapIntensity: 0.1 });
    const floor = new THREE.MeshStandardMaterial({ map: pavingTexture(0.25), color: 0xb8a888, roughness: 0.28, metalness: 0.05, envMap: this.env, envMapIntensity: 0.12 });
    const h = -FLOOR;

    // sol en pierre polie : vrai reflet de l'hélice et de la pyramide inversée
    const f = new Reflector(new THREE.PlaneGeometry(2 * HALL, 2 * HALL), {
      textureWidth: innerWidth * this.dpr * 0.5,
      textureHeight: innerHeight * this.dpr * 0.5,
      color: 0xffffff,
      clipBias: 0.003,
      shader: HallFloorShader,
    });
    f.material.uniforms.tMap.value = floor.map;
    f.rotation.x = -Math.PI / 2;
    f.position.y = FLOOR;
    this.hallFloor = f;
    this.scene.add(f);
    // sol de secours quand le miroir est coupé (vu de loin, à travers le verre)
    const base = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALL, 2 * HALL), floor);
    base.rotation.x = -Math.PI / 2;
    base.position.y = FLOOR - 0.02;
    this.scene.add(base);

    // plafond percé sous la pyramide
    const cs = new THREE.Shape([new THREE.Vector2(-HALL, -HALL), new THREE.Vector2(HALL, -HALL), new THREE.Vector2(HALL, HALL), new THREE.Vector2(-HALL, HALL)]);
    cs.holes.push(new THREE.Path([new THREE.Vector2(-B, -B), new THREE.Vector2(B, -B), new THREE.Vector2(B, B), new THREE.Vector2(-B, B)]));
    const coffers = cofferTexture();
    coffers.repeat.set(1 / 5, 1 / 5);
    const ceil = new THREE.Mesh(new THREE.ShapeGeometry(cs), new THREE.MeshStandardMaterial({ map: coffers, roughness: 0.9 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = -0.25;
    this.scene.add(ceil);

    const wall = (w, hh, x, y, z, ry) => {
      const g = new THREE.PlaneGeometry(w, hh);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w + x + z) / 11, (uv.getY(i) * hh + y) / 11);
      const m = new THREE.Mesh(g, blocks);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      this.scene.add(m);
    };
    wall(2 * HALL, h, 0, FLOOR / 2, HALL, Math.PI);
    wall(2 * HALL, h, -HALL, FLOOR / 2, 0, Math.PI / 2);
    wall(2 * HALL, h, HALL, FLOOR / 2, 0, -Math.PI / 2);
    // mur nord percé vers la Grande Galerie
    const side = HALL - GAL_W;
    wall(side, h, -GAL_W - side / 2, FLOOR / 2, -HALL, 0);
    wall(side, h, GAL_W + side / 2, FLOOR / 2, -HALL, 0);
    wall(2 * GAL_W, -WALL_TOP, 0, WALL_TOP / 2, -HALL, 0);

    // portail doré et enseigne de l'aile Denon
    const gold = this.goldMat();
    const pz = -HALL + 0.15;
    this.scene.add(beam(new THREE.Vector3(-GAL_W, FLOOR, pz), new THREE.Vector3(-GAL_W, WALL_TOP, pz), 0.25, gold, 4));
    this.scene.add(beam(new THREE.Vector3(GAL_W, FLOOR, pz), new THREE.Vector3(GAL_W, WALL_TOP, pz), 0.25, gold, 4));
    this.scene.add(beam(new THREE.Vector3(-GAL_W - 0.25, WALL_TOP, pz), new THREE.Vector3(GAL_W + 0.25, WALL_TOP, pz), 0.25, gold, 4));
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 2.5),
      new THREE.MeshBasicMaterial({ map: signTexture('DENON', 'Peintures · Grande Galerie'), transparent: true, depthWrite: false })
    );
    sign.position.set(0, WALL_TOP + 2.6, pz + 0.05);
    this.scene.add(sign);

    // mezzanine en U, piliers, garde-corps de verre
    const slabY = -7;
    const depth = 4.5;
    const glassMat = new THREE.MeshBasicMaterial({ color: 0xa8d0e6, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xc4b08c, roughness: 0.6 });
    const mezz = [
      [-HALL + depth / 2, 0, depth, 2 * HALL],
      [HALL - depth / 2, 0, depth, 2 * HALL],
      [0, HALL - depth / 2, 2 * HALL - 2 * depth, depth],
    ];
    mezz.forEach(([x, z, w, d]) => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), stone);
      s.position.set(x, slabY, z);
      this.scene.add(s);
    });
    const e = HALL - depth;
    const edge = [
      [new THREE.Vector3(-e, 0, -HALL), new THREE.Vector3(-e, 0, e)],
      [new THREE.Vector3(-e, 0, e), new THREE.Vector3(e, 0, e)],
      [new THREE.Vector3(e, 0, e), new THREE.Vector3(e, 0, -HALL)],
    ];
    edge.forEach(([a, b]) => {
      const len = a.distanceTo(b);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.1), glassMat);
      gl.position.copy(a).add(b).multiplyScalar(0.5).setY(slabY + 0.9);
      gl.rotation.y = Math.abs(a.x - b.x) < 0.01 ? Math.PI / 2 : 0;
      this.scene.add(gl);
      this.scene.add(beam(a.clone().setY(slabY + 1.45), b.clone().setY(slabY + 1.45), 0.05, this.goldMat(), 6));
      const n = Math.round(len / 8);
      for (let i = 0; i <= n; i++) {
        const p = a.clone().lerp(b, i / n);
        const pil = new THREE.Mesh(new THREE.BoxGeometry(0.9, slabY - FLOOR, 0.9), pillarMat);
        pil.position.set(p.x, (FLOOR + slabY) / 2, p.z);
        this.scene.add(pil);
      }
    });

    // banque d'accueil circulaire au pied de l'escalier
    const desk = new THREE.Mesh(
      new THREE.LatheGeometry([new THREE.Vector2(4.4, 0), new THREE.Vector2(5.1, 0), new THREE.Vector2(5.1, 1.1), new THREE.Vector2(4.4, 1.1), new THREE.Vector2(4.4, 0)], 96),
      new THREE.MeshStandardMaterial({ color: 0xd7c8a8, roughness: 0.35, envMap: this.env, envMapIntensity: 0.3 })
    );
    desk.position.y = FLOOR;
    this.scene.add(desk);
    const strip = new THREE.Mesh(new THREE.TorusGeometry(4.75, 0.035, 6, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.9) }));
    strip.rotation.x = Math.PI / 2;
    strip.position.y = FLOOR + 1.12;
    this.scene.add(strip);

    // la Pyramide inversée et sa petite pyramide de pierre
    const inv = new THREE.Mesh(pyramidGeometry(5.5, 9.35), this.glass);
    inv.scale.y = -1;
    inv.position.copy(INV);
    inv.renderOrder = 2;
    this.scene.add(inv);
    const lightBox = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.93, 0.88) }));
    lightBox.rotation.x = Math.PI / 2;
    lightBox.position.set(INV.x, -0.27, INV.z);
    this.scene.add(lightBox);
    const steel = new THREE.MeshStandardMaterial({ color: 0x9a948c, metalness: 0.9, roughness: 0.35, envMap: this.env });
    const tip = new THREE.Vector3(INV.x, INV.y - 9.35, INV.z);
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz], i, arr) => {
      const c = new THREE.Vector3(INV.x + sx * 5.5, INV.y, INV.z + sz * 5.5);
      const [nx, nz] = arr[(i + 1) % 4];
      this.scene.add(beam(c, tip, 0.06, steel));
      this.scene.add(beam(c, new THREE.Vector3(INV.x + nx * 5.5, INV.y, INV.z + nz * 5.5), 0.12, steel));
    });
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(5.6, 3.2, 5.6), stone);
    plinth.position.set(INV.x, FLOOR + 1.6, INV.z);
    this.scene.add(plinth);
    const small = new THREE.Mesh(pyramidGeometry(2.2, 2.6), stone);
    small.position.set(INV.x, FLOOR + 3.2, INV.z);
    this.scene.add(small);
    const invLight = new THREE.PointLight(0xe8f0ff, 90, 0, 2);
    invLight.position.set(INV.x, -4, INV.z);
    this.scene.add(invLight);

    // rayons de lumière tombant de la pyramide
    const shaftMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vW; varying vec3 vN;
        void main(){
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; varying vec3 vW; varying vec3 vN;
        ${NOISE}
        void main(){
          float a = pow(smoothstep(${FLOOR.toFixed(1)}, 0.0, vW.y), 1.6);
          float f = pow(abs(dot(normalize(vN), normalize(cameraPosition - vW))), 1.5);
          float s = noise(vec2((vW.x + vW.z) * 0.7, vW.y * 0.05 - uTime * 0.04));
          s = 0.25 + 0.75 * smoothstep(0.35, 0.9, s);
          vec3 c = vec3(1.0, 0.82, 0.58) * a * f * s * 0.16;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.updatables.push(shaftMat);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(B * Math.SQRT2, 13 * Math.SQRT2, -FLOOR, 4, 1, true), shaftMat);
    shaft.rotation.y = Math.PI / 4;
    shaft.position.y = FLOOR / 2;
    this.scene.add(shaft);
    const inner = shaft.clone();
    inner.scale.set(0.55, 1, 0.55);
    this.scene.add(inner);

    // escalier hélicoïdal
    const N = 74;
    const turns = 2;
    const top = -1.2;
    const stepMat = new THREE.MeshStandardMaterial({ color: 0xa9a294, roughness: 0.45, envMap: this.env, envMapIntensity: 0.35 });
    const steps = new THREE.InstancedMesh(new THREE.BoxGeometry(2.9, 0.16, 0.62), stepMat, N);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const a = t * turns * Math.PI * 2;
      const y = FLOOR + 0.2 + t * (top - FLOOR);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      mtx.compose(new THREE.Vector3(Math.cos(a) * 2.05, y, Math.sin(a) * 2.05), q, new THREE.Vector3(1, 1, 1));
      steps.setMatrixAt(i, mtx);
    }
    this.scene.add(steps);

    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, top - FLOOR, 32), new THREE.MeshStandardMaterial({ color: 0xb5a78c, roughness: 0.5 }));
    col.position.y = (FLOOR + top) / 2;
    this.scene.add(col);

    const helix = new HelixCurve(3.45, FLOOR + 0.2, top, turns);
    const rail = new THREE.Mesh(
      new THREE.TubeGeometry(new HelixCurve(3.45, FLOOR + 1.3, top + 1.1, turns), 300, 0.06, 8),
      new THREE.MeshStandardMaterial({ color: 0xe0d6c4, metalness: 1, roughness: 0.2, envMap: this.env, emissive: 0x2a1a08 })
    );
    this.scene.add(rail);
    this.scene.add(
      new THREE.Mesh(
        ribbonGeometry(helix, 1.1, 300),
        new THREE.MeshBasicMaterial({ color: 0xa8d0e6, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false })
      )
    );
  }

  /* ---------- Grande Galerie ---------- */
  buildGallery(list, joconde) {
    const len = -GAL_END - HALL;
    const midZ = (GAL_END - HALL) / 2;

    const floorTex = parquetTexture();
    floorTex.repeat.set(2, len / 6);
    const parquet = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * GAL_W, len),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.32, envMap: this.env, envMapIntensity: 0.35 })
    );
    parquet.rotation.x = -Math.PI / 2;
    parquet.position.set(0, FLOOR + 0.01, midZ);
    this.scene.add(parquet);

    const wallTex = damaskTexture();
    wallTex.repeat.set(len / 5, 2);
    const red = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
    [-1, 1].forEach((s) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, WALL_TOP - FLOOR), red);
      m.position.set(s * GAL_W, (FLOOR + WALL_TOP) / 2, midZ);
      m.rotation.y = -s * Math.PI / 2;
      this.scene.add(m);
      // corniche dorée
      this.scene.add(
        beam(new THREE.Vector3(s * (GAL_W - 0.1), WALL_TOP, -HALL), new THREE.Vector3(s * (GAL_W - 0.1), WALL_TOP, GAL_END), 0.18, this.goldMat(), 4)
      );
    });
    const end = new THREE.Mesh(new THREE.PlaneGeometry(2 * GAL_W, WALL_TOP - FLOOR + 6), red);
    end.position.set(0, (FLOOR + WALL_TOP + 6) / 2, GAL_END);
    this.scene.add(end);

    // voûte en berceau et verrière zénithale
    const vault = new THREE.Mesh(
      new THREE.CylinderGeometry(GAL_W, GAL_W, len, 40, 1, true, Math.PI / 2, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0xa8977a, roughness: 0.85, side: THREE.DoubleSide })
    );
    vault.rotation.x = Math.PI / 2;
    vault.position.set(0, WALL_TOP, midZ);
    this.scene.add(vault);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(2.2, len), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.6, 1.45) }));
    sky.rotation.x = Math.PI / 2;
    sky.position.set(0, WALL_TOP + GAL_W - 0.12, midZ);
    this.scene.add(sky);

    const rect = new THREE.RectAreaLight(0xfff0d8, 3.2, 4, len);
    rect.position.set(0, WALL_TOP + GAL_W - 0.5, midZ);
    rect.rotation.x = -Math.PI / 2;
    this.scene.add(rect);

    // accrochage
    list.forEach((p, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const z = -34 - i * 14;
      const g = this.framedPainting(p, 6.2, 9.4);
      g.position.set(side * (GAL_W - 0.18), 0, z);
      g.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.scene.add(g);
    });

    // la Joconde
    const mona = this.framedPainting(joconde, 3.5, 3, 0x8a6a34, 3.4);
    this.monaMesh = this.paintingMeshes[this.paintingMeshes.length - 1];
    mona.position.set(0, 0, GAL_END + 0.45);
    this.scene.add(mona);

    this.scene.add(this.dust(1100, [-5.5, FLOOR + 0.5, GAL_END], [5.5, -1, -HALL], 0xffe3b8, 4));
  }

  goldMat() {
    return (this._gold ??= new THREE.MeshStandardMaterial({ color: 0xc9a052, metalness: 1, roughness: 0.3, envMap: this.env, envMapIntensity: 1.4 }));
  }

  framedPainting(p, maxH, maxW, frameColor, forceH) {
    const img = this.images[p.id];
    const asp = img.width / img.height;
    let h = forceH ?? THREE.MathUtils.clamp(p.h * 0.0105, 1.7, maxH);
    let w = h * asp;
    if (w > maxW) {
      w = maxW;
      h = w / asp;
    }
    const cy = Math.max(-10.4, FLOOR + 2.2 + h / 2);
    const g = new THREE.Group();

    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.86, 0.86, 0.86) });
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    canvas.position.set(0, cy, 0.02);
    canvas.userData = { painting: p, mat };
    this.paintingMeshes.push(canvas);
    g.add(canvas);

    const t = 0.22 + 0.035 * Math.max(w, h);
    const fm = frameColor
      ? new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.5, metalness: 0.4, envMap: this.env })
      : this.goldMat();
    const add = (bw, bh, x, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.28), fm);
      m.position.set(x, cy + y, 0.08);
      g.add(m);
    };
    add(w + 2 * t, t, 0, h / 2 + t / 2);
    add(w + 2 * t, t, 0, -h / 2 - t / 2);
    add(t, h, -w / 2 - t / 2, 0);
    add(t, h, w / 2 + t / 2, 0);

    // halo d'éclairage muséal
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 1.9 + 3, h * 1.7 + 3),
      new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,226,180,0.32)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    halo.position.set(0, cy + 0.3, -0.15);
    g.add(halo);
    canvas.userData.halo = halo;
    return g;
  }

  dust(n, min, max, color, size) {
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) pos[i * 3 + k] = min[k] + Math.random() * (max[k] - min[k]);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uSize: { value: size * this.dpr * 10 }, uColor: { value: new THREE.Color(color) } },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uSize; attribute float aSeed; varying float vA;
        void main(){
          vec3 p = position;
          p.y += sin(uTime * 0.25 + aSeed * 6.28) * 0.6;
          p.x += cos(uTime * 0.18 + aSeed * 12.0) * 0.4;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * (0.4 + aSeed) / -mv.z;
          vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 1.3 + aSeed * 40.0));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA * 0.8; gl_FragColor = vec4(uColor * a, a); }`,
    });
    this.updatables.push(mat);
    return new THREE.Points(g, mat);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x6f80aa, 0x1a120a, 0.45));
    const moon = new THREE.DirectionalLight(0x9fb3e0, 0.6);
    moon.position.set(-60, 90, -40);
    this.scene.add(moon);
    const pyr = new THREE.PointLight(0xffc27e, 700, 0, 2);
    pyr.position.set(0, 7.5, 0);
    this.scene.add(pyr);
    const hall = new THREE.PointLight(0xffd6a0, 160, 0, 2);
    hall.position.set(9, -6, 9);
    this.scene.add(hall);
    const deep = new THREE.PointLight(0xffd6a0, 150, 0, 2);
    deep.position.set(0, -7, -140);
    this.scene.add(deep);
  }

  buildPost() {
    const w = innerWidth;
    const h = innerHeight;
    const rt = new THREE.WebGLRenderTarget(w * this.dpr, h * this.dpr, { type: THREE.HalfFloatType, samples: 4 });
    const c = (this.composer = new EffectComposer(this.renderer, rt));
    c.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.75, 0.55, 0.9);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
    this.finish = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFade: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform float uTime; uniform float uFade; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          float v = smoothstep(1.15, 0.25, length((vUv - 0.5) * vec2(1.1, 1.0)));
          c.rgb *= mix(0.45, 1.0, v);
          float g = fract(sin(dot(vUv * 1000.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
          c.rgb += (g - 0.5) * 0.035;
          c.rgb *= 1.0 - uFade;
          gl_FragColor = c;
        }`,
    });
    c.addPass(this.finish);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  pathAt(p, out, look) {
    const t = THREE.MathUtils.clamp(p, 0, 1);
    this.posCurve.getPoint(t, out);
    this.lookCurve.getPoint(t, look);
  }

  update() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.elapsedTime;
    this.progress += (this.target - this.progress) * (1 - Math.exp(-dt * 3.2));
    this.smoothMouse.lerp(this.mouse, 1 - Math.exp(-dt * 2.5));
    if (!this.active) return;

    const p = this.progress;
    const pos = (this._p ??= new THREE.Vector3());
    const look = (this._l ??= new THREE.Vector3());
    this.pathAt(p, pos, look);

    const k = 1 - this.intro;
    const e = k * k * (3 - 2 * k);
    pos.x += -18 * e;
    pos.y += 26 * e;
    pos.z += 55 * e;

    const sway = p > 0.62 ? 1.4 : 0.8;
    pos.x += this.smoothMouse.x * sway;
    pos.y += this.smoothMouse.y * 0.5;
    look.x += this.smoothMouse.x * sway * 0.4;

    this.camera.position.copy(pos);
    const dummy = (this._d ??= new THREE.PerspectiveCamera());
    dummy.position.copy(pos);
    dummy.lookAt(look);
    // léger roulis dans les virages
    const yaw = Math.atan2(look.x - pos.x, look.z - pos.z);
    let dy = yaw - (this._yaw ?? yaw);
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this._yaw = yaw;
    this._yawVel = THREE.MathUtils.lerp(this._yawVel ?? 0, dy / Math.max(dt, 1e-3), 1 - Math.exp(-dt * 4));
    const roll = THREE.MathUtils.clamp(this._yawVel * 0.06, -0.1, 0.1);
    dummy.rotateZ(roll);
    if (this._snap === undefined) this.camera.quaternion.copy(dummy.quaternion);
    this._snap = false;
    this.camera.quaternion.slerp(dummy.quaternion, 1 - Math.exp(-dt * 7));

    // flash lumineux à la traversée du verre
    const d = Math.max(Math.abs(pos.x), Math.abs(pos.z)) - B * (1 - pos.y / H);
    const flash = pos.y > 0 && pos.y < H ? Math.exp(-d * d * 1.2) : 0;
    this.bloom.strength = 0.75 + flash * 1.4;
    this.renderer.toneMappingExposure = 1.05 + flash * 0.35;

    // focale : plus large dans le hall, resserrée sur la Joconde
    const inHall = THREE.MathUtils.smoothstep(-pos.y, 1, 4) * THREE.MathUtils.smoothstep(pos.z, -34, -20);
    const fov = 50 + inHall * 10 - THREE.MathUtils.smoothstep(p, 0.94, 1) * 7;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // atmosphère : nuit de Paris dehors, lumière chaude dessous
    const under = THREE.MathUtils.smoothstep(pos.y, 2, -3);
    const fog = this.scene.fog;
    fog.color.setRGB(0.02 + under * 0.05, 0.027 + under * 0.03, 0.047 - under * 0.02);
    // dehors, on allège le brouillard quand la caméra est loin (intro) pour que le palais reste éclairé
    const far = Math.min(1, 105 / Math.max(105, pos.length()));
    fog.density = THREE.MathUtils.lerp(0.0055 * far, 0.0085, under);
    this.water.visible = pos.y > 0.3;
    // miroir actif sous terre, mais aussi dès qu'on est sous le verre de la pyramide
    this.hallFloor.visible = pos.z > -60 && (pos.y < -0.5 || (pos.y < H && Math.max(Math.abs(pos.x), Math.abs(pos.z)) < B + 4));
    this.sky.position.copy(pos);
    this.stars.position.copy(pos);
    this.moon.position.copy(pos).add(this.moonOffset);
    this.moon.lookAt(pos);

    this.glass.uniforms.uTime.value = time;
    this.facade.uniforms.uTime.value = time;
    this.water.material.uniforms.uTime.value = time;
    this.updatables.forEach((m) => (m.uniforms.uTime.value = time));
    this.finish.uniforms.uTime.value = time;
    this.finish.uniforms.uFade.value = THREE.MathUtils.smoothstep(p, 0.975, 1.0);

    this.hover(p);
    this.composer.render(dt);
    if (p > 0.9) this.monaRect = this.screenRect(this.monaMesh);
  }

  // Rectangle à l'écran (px CSS) d'une toile, pour le passage de relais vers le DOM.
  screenRect(mesh) {
    const b = (mesh.geometry.boundingBox ??= new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position));
    const v = (this._v ??= new THREE.Vector3());
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of [b.min.x, b.max.x])
      for (const y of [b.min.y, b.max.y]) {
        v.set(x, y, 0).applyMatrix4(mesh.matrixWorld).project(this.camera);
        const sx = ((v.x + 1) / 2) * innerWidth;
        const sy = ((1 - v.y) / 2) * innerHeight;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx);
        y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  hover(p) {
    let hit = null;
    if (p > 0.64 && p < 0.985 && this.pointer) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const i = this.raycaster.intersectObjects(this.paintingMeshes, false)[0];
      if (i && i.distance < 42) hit = i.object;
    }
    if (hit !== this.hovered) {
      if (this.hovered) {
        this.hovered.userData.mat.color.setScalar(0.86);
        this.hovered.userData.halo.material.opacity = 1;
      }
      if (hit) {
        hit.userData.mat.color.setScalar(1.05);
        hit.userData.halo.material.opacity = 1.8;
      }
      this.hovered = hit;
    }
    this.onHover(hit ? hit.userData.painting : null, this.pointer);
  }
}

/* ---------- utilitaires ---------- */

const WaterShader = {
  name: 'LouvreWater',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW;
    void main(){
      vUv = textureMatrix * vec4(position, 1.0);
      vW = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color; uniform sampler2D tDiffuse; uniform float uTime;
    varying vec4 vUv; varying vec3 vW;
    ${NOISE}
    void main(){
      vec2 p = vW.xz * 0.45;
      vec2 off = vec2(noise(p + uTime * 0.35), noise(p * 1.7 - uTime * 0.3)) - 0.5;
      vec4 uv = vUv;
      uv.xy += off * 0.018 * uv.w;
      vec3 base = texture2DProj(tDiffuse, uv).rgb;
      float dist = length(vW - cameraPosition);
      vec3 c = base * color + vec3(0.01, 0.015, 0.025);
      c = mix(c, vec3(0.02, 0.027, 0.047), 1.0 - exp(-pow(dist * 0.0055, 2.0)));
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

const HallFloorShader = {
  name: 'HallFloor',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, tMap: { value: null } },
  vertexShader: WaterShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform vec3 color; uniform sampler2D tDiffuse; uniform sampler2D tMap;
    varying vec4 vUv; varying vec3 vW;
    void main(){
      vec3 base = texture2D(tMap, vW.xz / 6.0).rgb * vec3(0.78, 0.7, 0.58);
      float r = length(vW.xz);
      vec2 q = vW.xz - vec2(${INV.x.toFixed(1)}, ${INV.z.toFixed(1)});
      vec3 light = vec3(1.0, 0.84, 0.62) * (0.16 + exp(-r * r / 160.0) * 0.75) + vec3(0.85, 0.92, 1.0) * exp(-dot(q, q) / 40.0) * 0.5;
      vec3 refl = texture2DProj(tDiffuse, vUv).rgb;
      float fres = 0.22 + 0.4 * pow(1.0 - abs(normalize(cameraPosition - vW).y), 3.0);
      gl_FragColor = vec4(base * light + refl * fres * color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

function pyramidGeometry(b, h) {
  const apex = [0, h, 0];
  const c = [
    [-b, 0, b],
    [b, 0, b],
    [b, 0, -b],
    [-b, 0, -b],
  ];
  const pos = [];
  const bary = [];
  for (let i = 0; i < 4; i++) {
    pos.push(...c[i], ...c[(i + 1) % 4], ...apex);
    bary.push(1, 0, 0, 0, 1, 0, 0, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('bary', new THREE.Float32BufferAttribute(bary, 3));
  g.computeVertexNormals();
  return g;
}

function beam(a, b, r, mat, seg = 6) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

class HelixCurve extends THREE.Curve {
  constructor(r, y0, y1, turns) {
    super();
    Object.assign(this, { r, y0, y1, turns });
  }
  getPoint(t, out = new THREE.Vector3()) {
    const a = t * this.turns * Math.PI * 2;
    return out.set(Math.cos(a) * this.r, this.y0 + t * (this.y1 - this.y0), Math.sin(a) * this.r);
  }
}

function ribbonGeometry(curve, height, seg) {
  const pos = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const p = curve.getPoint(i / seg);
    pos.push(p.x, p.y, p.z, p.x, p.y + height, p.z);
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function pavingTexture(rep = 1 / 6) {
  const t = canvasTex(512, (g, s) => {
    g.fillStyle = '#1d1a16';
    g.fillRect(0, 0, s, s);
    const n = 4;
    const c = s / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const v = 52 + Math.random() * 18;
        g.fillStyle = `rgb(${v + 8},${v + 3},${v - 4})`;
        g.fillRect(i * c + 2, j * c + 2, c - 4, c - 4);
      }
    for (let k = 0; k < 5000; k++) {
      g.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 240 : 0},200,0.05)`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  });
  t.repeat.set(rep, rep);
  return t;
}

function parquetTexture() {
  return canvasTex(512, (g, s) => {
    const rows = 8;
    const rh = s / rows;
    for (let r = 0; r < rows; r++) {
      let x = -Math.random() * 200;
      while (x < s) {
        const w = 120 + Math.random() * 160;
        const v = Math.random() * 25;
        g.fillStyle = `rgb(${92 + v},${56 + v * 0.7},${30 + v * 0.4})`;
        g.fillRect(x, r * rh, w - 2, rh - 2);
        for (let k = 0; k < 6; k++) {
          g.strokeStyle = `rgba(40,20,8,${0.08 + Math.random() * 0.1})`;
          g.beginPath();
          const yy = r * rh + Math.random() * rh;
          g.moveTo(x, yy);
          g.bezierCurveTo(x + w * 0.3, yy + 3, x + w * 0.6, yy - 3, x + w, yy);
          g.stroke();
        }
        x += w;
      }
    }
  });
}

function damaskTexture() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#5a1714';
    g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(120,40,30,0.35)';
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        const cx = i * 128 + 64;
        const cy = j * 128 + 64;
        g.beginPath();
        g.ellipse(cx, cy, 22, 40, 0, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.ellipse(cx - 64, cy - 64, 14, 26, 0, 0, Math.PI * 2);
        g.fill();
      }
  });
}

function radialTexture(inner) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function blockTexture() {
  return canvasTex(512, (g, s) => {
    g.fillStyle = '#8f7d60';
    g.fillRect(0, 0, s, s);
    const rows = 6;
    const rh = s / rows;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? s / 4 : 0;
      for (let x = -off; x < s; x += s / 2) {
        const v = Math.random() * 18;
        g.fillStyle = `rgb(${150 + v},${132 + v},${104 + v})`;
        g.fillRect(x + 2, r * rh + 2, s / 2 - 4, rh - 4);
      }
    }
    for (let k = 0; k < 4000; k++) {
      g.fillStyle = `rgba(80,60,30,${Math.random() * 0.08})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  });
}

function signTexture(title, sub) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.fillStyle = '#f3dfb4';
  g.font = '300 128px "Cormorant Garamond", serif';
  g.letterSpacing = '40px';
  g.fillText(title, 532, 140);
  g.font = '500 30px "Inter Tight", sans-serif';
  g.letterSpacing = '10px';
  g.fillStyle = 'rgba(243,223,180,0.75)';
  g.fillText(sub.toUpperCase(), 517, 210);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function cofferTexture() {
  return canvasTex(256, (g, s) => {
    // caissons triangulaires du plafond de Pei
    const tri = (pts, cx, cy) => {
      const grd = g.createRadialGradient(cx, cy, 2, cx, cy, s * 0.45);
      grd.addColorStop(0, '#5f5443');
      grd.addColorStop(1, '#8c7f66');
      g.fillStyle = grd;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
    };
    const c = s / 2;
    tri([[0, 0], [s, 0], [c, c]], c, c * 0.45);
    tri([[s, 0], [s, s], [c, c]], s - c * 0.45, c);
    tri([[s, s], [0, s], [c, c]], c, s - c * 0.45);
    tri([[0, s], [0, 0], [c, c]], c * 0.45, c);
    g.strokeStyle = '#c4b493';
    g.lineWidth = 8;
    g.strokeRect(0, 0, s, s);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(s, s);
    g.moveTo(s, 0);
    g.lineTo(0, s);
    g.stroke();
  });
}
