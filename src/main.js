import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './style.css';
import { paintings, masters, corridor, byId } from './data.js';
import { Journey } from './journey.js';
import { BrushStage } from './brush.js';
import { Cursor } from './cursor.js';

gsap.registerPlugin(ScrollTrigger);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fine = matchMedia('(pointer: fine)').matches;

history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
if (import.meta.env.DEV) window.__lenis = lenis;
lenis.stop();
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.lagSmoothing(0);

$$('a[href^="#"]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    lenis.scrollTo(a.getAttribute('href') === '#top' ? 0 : a.getAttribute('href'), { duration: 2.2 });
  })
);

/* ---------- Chargement ---------- */
async function preload() {
  const pct = $('.loader__pct');
  const bar = $('.loader__bar span');
  let done = 0;
  const images = {};
  await Promise.all(
    paintings.map(
      (p) =>
        new Promise((res) => {
          const im = new Image();
          im.decoding = 'async';
          im.onload = im.onerror = () => {
            done++;
            const v = Math.round((done / paintings.length) * 100);
            pct.textContent = v;
            bar.style.transform = `scaleX(${v / 100})`;
            res();
          };
          im.src = `/paintings/${p.id}.jpg`;
          images[p.id] = im;
        })
    )
  );
  await document.fonts.ready;
  return images;
}

const images = await preload();

/* ---------- Scène 3D ---------- */
const journey = new Journey($('#journey-canvas'), images, corridor, byId.joconde);
if (import.meta.env.DEV) window.__journey = journey;
const brush = new BrushStage($('#brush-canvas'), images);
const cursor = fine ? new Cursor($('.cursor'), $('#trail')) : null;
if (!fine) document.body.classList.add('touch');

const tag = $('.tag');
journey.onHover = (p, pt) => {
  tag.classList.toggle('is-on', !!p);
  if (p) {
    $('.tag__title').textContent = p.title;
    $('.tag__meta').textContent = `${p.artist} · ${p.year}`;
    tag.style.transform = `translate3d(${pt.x + 24}px, ${pt.y + 18}px, 0)`;
  }
  document.body.classList.toggle('is-pointing', !!p);
};

const chapters = $$('.chapter').map((el) => ({ el, a: +el.dataset.in, b: +el.dataset.out }));
const fadeIn = 0.035;
function drawChapters(p) {
  for (const c of chapters) {
    const v = Math.min(gsap.utils.clamp(0, 1, (p - c.a) / fadeIn), gsap.utils.clamp(0, 1, (c.b - p) / fadeIn));
    c.el.style.opacity = v;
    c.el.style.visibility = v > 0.001 ? 'visible' : 'hidden';
    c.el.style.transform = `translate3d(0, ${(1 - v) * (p < c.a + fadeIn ? 30 : -30)}px, 0)`;
  }
  $('.journey__progress i').style.transform = `scaleX(${p})`;
}

ScrollTrigger.create({
  trigger: '#journey',
  start: 'top top',
  end: 'bottom bottom',
  onUpdate: (s) => (journey.target = s.progress),
});
ScrollTrigger.create({
  trigger: '#journey',
  start: 'top bottom',
  end: 'bottom top',
  onToggle: (s) => {
    journey.active = s.isActive;
    document.body.classList.toggle('in-journey', s.isActive);
  },
});

/* ---------- Chefs-d'œuvre ---------- */
let mIdx = -1;
let revealed = false;
const mText = $('.masters__text');
function setMaster(i, instant) {
  if (i === mIdx) return;
  mIdx = i;
  const p = masters[i];
  brush.show(p.id, instant);
  $$('.masters__dots li').forEach((li, k) => li.classList.toggle('is-on', k === i));
  revealed = false;
  $('.masters__reveal').textContent = "Révéler l'œuvre";
  const fill = () => {
    $('.masters__idx').textContent = String(i + 1).padStart(2, '0');
    $('.masters__title').textContent = p.title;
    $('.masters__artist').innerHTML = `${p.artist} · <span class="masters__year">${p.year}</span>`;
    $('.masters__desc').textContent = p.text;
    $('.m-medium').textContent = p.medium;
    $('.m-size').textContent = p.size;
    $('.m-room').textContent = p.room;
  };
  if (instant) return fill();
  gsap
    .timeline()
    .to(mText.children, { y: -24, opacity: 0, duration: 0.35, stagger: 0.03, ease: 'power2.in' })
    .add(fill)
    .fromTo(mText.children, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.05, ease: 'power3.out' });
}
setMaster(0, true);

$('.masters__reveal').addEventListener('click', () => {
  revealed = !revealed;
  brush.setFull(revealed);
  $('.masters__reveal').textContent = revealed ? "Revenir à l'esquisse" : "Révéler l'œuvre";
});

ScrollTrigger.create({
  trigger: '#masters',
  start: 'top top',
  end: 'bottom bottom',
  onUpdate: (s) => setMaster(Math.min(masters.length - 1, Math.floor(s.progress * masters.length))),
});
/* ---------- Passage de relais : la Joconde quitte la galerie 3D ---------- */
const handoff = $('.handoff');
const stageCanvas = $('#brush-canvas');
let hand = 0;
let handed = false;
ScrollTrigger.create({
  trigger: '#masters',
  start: 'top bottom',
  end: 'top top',
  onUpdate: (s) => (hand = s.progress),
});
const ease = gsap.parseEase('power3.inOut');
const lerp = (a, b, t) => a + (b - a) * t;
function drawHandoff() {
  const p = journey.progress;
  const from = journey.monaRect;
  const show = from && (hand > 0 || p > 0.955) && hand < 0.995;
  $('.masters__text').style.opacity = gsap.utils.clamp(0, 1, (hand - 0.45) / 0.5);
  $('.chapters').style.opacity = 1 - gsap.utils.clamp(0, 1, hand * 3);

  if (!show) {
    handoff.style.visibility = 'hidden';
    if (hand >= 0.995 && !handed) {
      handed = true;
      stageCanvas.style.opacity = 1;
      document.body.classList.add('is-handed');
      if (mIdx === 0) brush.dissolve(() => brush.autoStroke(0.1));
    }
    if (hand < 0.995) stageCanvas.style.opacity = 0;
    return;
  }
  if (handed) {
    handed = false;
    document.body.classList.remove('is-handed');
  }
  brush.holdColor();
  stageCanvas.style.opacity = 0;

  const to = brush.paintingRect('joconde');
  const t = ease(hand);
  const x = lerp(from.x, to.x, t);
  const y = lerp(from.y, to.y, t);
  const w = lerp(from.w, to.w, t);
  const h = lerp(from.h, to.h, t);
  handoff.style.visibility = 'visible';
  handoff.style.opacity = hand > 0 ? 1 : gsap.utils.clamp(0, 1, (p - 0.955) / 0.02);
  handoff.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  handoff.style.width = `${w}px`;
  handoff.style.height = `${h}px`;
  handoff.style.setProperty('--frame', `${lerp(from.h * 0.06, to.frame, t)}px`);
  handoff.style.setProperty('--b', lerp(0.86, 1, t));
}

/* ---------- Collection ---------- */
const track = $('.collection__track');
paintings.forEach((p, i) => {
  const im = images[p.id];
  const card = document.createElement('article');
  card.className = 'art';
  card.dataset.cursor = 'view';
  card.dataset.cursorLabel = 'Voir';
  card.style.setProperty('--ar', (im.width / im.height).toFixed(3));
  card.innerHTML = `
    <div class="art__frame">
      <img class="art__sketch" src="/paintings/${p.id}.jpg" alt="" loading="lazy" />
      <img class="art__color" src="/paintings/${p.id}.jpg" alt="${p.title}, ${p.artist}" loading="lazy" />
    </div>
    <div class="art__cap">
      <span class="art__n">${String(i + 1).padStart(2, '0')}</span>
      <div><h3>${p.title}</h3><p>${p.artist} · ${p.year}</p></div>
    </div>`;
  track.appendChild(card);
});

const mm = gsap.matchMedia();
mm.add('(min-width: 800px)', () => {
  const dist = () => track.scrollWidth - innerWidth + parseFloat(getComputedStyle(track).paddingLeft);
  const tween = gsap.to(track, {
    x: () => -dist(),
    ease: 'none',
    scrollTrigger: {
      trigger: '#collection',
      start: 'top top',
      end: () => '+=' + dist(),
      pin: '.collection__pin',
      scrub: 0.6,
      invalidateOnRefresh: true,
    },
  });
  $$('.art').forEach((card) =>
    gsap.fromTo(
      card.querySelector('.art__frame'),
      { rotateY: -18, z: -120 },
      {
        rotateY: 18,
        z: -120,
        ease: 'none',
        scrollTrigger: { trigger: card, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true },
      }
    )
  );
});

/* ---------- Chiffres ---------- */
$$('[data-count]').forEach((el) => {
  const end = +el.dataset.count;
  const o = { v: 0 };
  const fmt = (v) =>
    el.hasAttribute('data-dec') ? v.toFixed(1).replace('.', ',') + ' M' : el.hasAttribute('data-sep') ? Math.round(v).toLocaleString('fr-FR') : Math.round(v);
  ScrollTrigger.create({
    trigger: el,
    start: 'top 85%',
    once: true,
    onEnter: () => gsap.to(o, { v: end, duration: 2.4, ease: 'expo.out', onUpdate: () => (el.textContent = fmt(o.v)) }),
  });
});

$$('.visit__head, .card-info, .visit__cta, .numbers__grid > div, .collection__head').forEach((el) =>
  gsap.from(el, { y: 60, opacity: 0, duration: 1.2, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%' } })
);
gsap.from('.footer__word', { yPercent: 40, opacity: 0, duration: 1.6, ease: 'power3.out', scrollTrigger: { trigger: '.footer', start: 'top 90%' } });

/* ---------- Boucle ---------- */
let last = performance.now();
gsap.ticker.add((t) => {
  lenis.raf(t * 1000);
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  journey.update();
  if (journey.active) drawChapters(journey.progress);
  drawHandoff();
  brush.update(Math.min(dt, 0.05));
  cursor?.update();
});

/* ---------- Ouverture ---------- */
journey.renderer.compile(journey.scene, journey.camera);
const tl = gsap.timeline({ delay: 0.2 });
tl.to('.loader__mark, .loader__bar, .loader__pct', { opacity: 0, y: -20, duration: 0.6, stagger: 0.05, ease: 'power2.in' })
  .to('.loader', { clipPath: 'inset(0 0 100% 0)', duration: 1.1, ease: 'expo.inOut' })
  .set('.loader', { display: 'none' })
  .to(journey, { intro: 1, duration: 3.6, ease: 'power3.out' }, '-=0.9')
  .from('.hero__title span', { yPercent: 110, opacity: 0, duration: 1.6, stagger: 0.07, ease: 'expo.out' }, '-=3.2')
  .from('.chapter--hero .eyebrow, .hero__sub, .scrollcue, .nav', { opacity: 0, y: 20, duration: 1.2, stagger: 0.12, ease: 'power3.out' }, '-=2.4')
  .add(() => lenis.start(), '-=2');

window.addEventListener('load', () => ScrollTrigger.refresh());
