<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { spring } from 'svelte/motion';
  import logo from '$lib/assets/bold-icon.png';

  // ── Props ──────────────────────────────────────────────────────────────────
  export let onBind: () => void = () => {};

  // ── Animation state machine ────────────────────────────────────────────────
  type Stage =
    | 'rest'
    | 'breaking'
    | 'releasing'
    | 'journeying'
    | 'collecting';

  let stage: Stage = 'rest';
  /** Prevents re-entry while an animation is already in progress. */
  let isAnimating = false;

  // ── Logo spring (snappy squash-and-stretch) ────────────────────────────────
  const logoScale = spring({ x: 1, y: 1 }, { stiffness: 0.8, damping: 0.7 });

  // ── Glow pulse trigger ─────────────────────────────────────────────────────
  let glowPulsing = false;

  // ── Timers (collected for cleanup) ─────────────────────────────────────────
  const timers: ReturnType<typeof setTimeout>[] = [];
  function after(ms: number, fn: () => void) {
    timers.push(setTimeout(fn, ms));
  }

  // ── Main sequence — replayable; block click re-triggers each time ─────────
  function runSequence() {
    if (isAnimating) return;
    isAnimating = true;
    timers.length = 0; // clear stale refs from previous run

    stage = 'breaking';

    after(300, () => { stage = 'releasing'; });
    after(500, () => { stage = 'journeying'; });

    after(950, () => {
      stage = 'collecting';
      glowPulsing = true;
      logoScale.set({ x: 1.22, y: 0.78 });
      after(110, () => logoScale.set({ x: 0.88, y: 1.18 }));
      after(220, () => logoScale.set({ x: 1.08, y: 0.94 }));
      after(330, () => logoScale.set({ x: 1, y: 1 }));
    });

    after(1430, () => {
      glowPulsing = false;
      isAnimating = false;
      stage = 'rest'; // block reappears — ready for next click
    });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  onMount(() => {
    after(800, runSequence);
  });

  onDestroy(() => {
    timers.forEach(clearTimeout);
  });

  // ── Derived helpers ────────────────────────────────────────────────────────
  $: blockVisible    = stage === 'rest';
  $: particlesActive = stage === 'breaking';
  $: coinVisible     = stage === 'releasing' || stage === 'journeying' || stage === 'collecting';
</script>

<!-- ═══════════════════════════════════════════════════════════════════════════
     TEMPLATE
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="gs-root" aria-label="Get Started onboarding">

  <!-- ── Upper content: logo + text + button ────────────────────────────────── -->
  <div class="gs-content">

    <!-- Logo + glow -->
    <div class="gs-logo-wrap" aria-hidden="true">
      <!-- Glow aura behind logo -->
      <div class="gs-glow" class:gs-glow--pulse={glowPulsing}></div>

      <!-- Logo image with spring-driven scale -->
      <img
        src={logo}
        alt="Bold Bitcoin logo"
        class="gs-logo"
        width="72"
        height="72"
        style="transform: scale({$logoScale.x},{$logoScale.y});"
      />
    </div>

    <p class="gs-brand">Bold Bitcoin</p>
    <h1 class="gs-title">Get Started</h1>
    <p class="gs-cta">Connect in 2 steps with your Bold app.</p>

    <button
      type="button"
      class="gs-bind-btn"
      on:click={onBind}
    >
      Bind wallet
    </button>
  </div>

  <!-- ── Bottom animation stage ────────────────────────────────────────────── -->
  <div class="gs-stage">

    <!-- Question Mark Block — click to replay animation -->
    {#if blockVisible}
      <div
        class="gs-block"
        role="button"
        tabindex="0"
        aria-label="Tap to play coin animation"
        on:click={runSequence}
        on:keydown={(e) => e.key === 'Enter' && runSequence()}
      >
        <!-- 3-D depth faces (SVG layer — no text, no centering concerns) -->
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="gs-block-depth" aria-hidden="true">
          <defs>
            <linearGradient id="blk-face" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%"   stop-color="#3a3a3a"/>
              <stop offset="100%" stop-color="#242424"/>
            </linearGradient>
            <linearGradient id="blk-top" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%"   stop-color="#505050"/>
              <stop offset="100%" stop-color="#3a3a3a"/>
            </linearGradient>
          </defs>
          <!-- 3-D left face -->
          <polygon points="0,6 6,0 6,58 0,64" fill="#1a1a1a"/>
          <!-- 3-D top face -->
          <polygon points="0,6 6,0 64,0 58,6" fill="url(#blk-top)"/>
          <!-- Main face -->
          <rect x="6" y="6" width="58" height="58" rx="4" fill="url(#blk-face)"/>
          <!-- Inner bevel highlight -->
          <rect x="8" y="8" width="54" height="2" fill="rgba(255,255,255,0.06)"/>
          <!-- Border -->
          <rect x="6" y="6" width="58" height="58" rx="4" fill="none"
                stroke="#555" stroke-width="1"/>
          <!-- Top highlight line -->
          <rect x="10" y="9" width="44" height="3" rx="1" fill="rgba(255,255,255,0.08)"/>
        </svg>
        <!-- Front face overlay: bounded to the SVG front rect (x=6,y=6, 58×58 px) -->
        <!-- Flexbox centering here is independent of the 3-D depth edges       -->
        <div class="gs-block-front">
          <span class="gs-block-qmark">?</span>
        </div>
      </div>
    {/if}

    <!-- Explosion particles (8 shards) -->
    {#if particlesActive}
      <div class="gs-particles">
        {#each [0,1,2,3,4,5,6,7] as i}
          <div class="gs-particle gs-particle--{i}"></div>
        {/each}
      </div>
    {/if}

    <!-- Bitcoin coin -->
    {#if coinVisible}
      <div
        class="gs-coin"
        class:gs-coin--releasing={stage === 'releasing'}
        class:gs-coin--journeying={stage === 'journeying'}
        class:gs-coin--collecting={stage === 'collecting'}
      >
        <svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg" class="gs-coin-svg">
          <defs>
            <radialGradient id="cFace" cx="38%" cy="30%" r="65%">
              <stop offset="0%"   stop-color="#FFFBE0"/>
              <stop offset="30%"  stop-color="#F7D036"/>
              <stop offset="68%"  stop-color="#D4900F"/>
              <stop offset="100%" stop-color="#9A5B00"/>
            </radialGradient>
            <radialGradient id="cEdge" cx="50%" cy="90%" r="72%">
              <stop offset="0%"   stop-color="#B07010"/>
              <stop offset="100%" stop-color="#5A3200"/>
            </radialGradient>
            <filter id="cGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feComposite in="SourceGraphic" in2="blur" operator="over"/>
            </filter>
          </defs>
          <!-- Glow halo -->
          <circle cx="28" cy="26" r="22" fill="rgba(247,208,54,0.22)" filter="url(#cGlow)"/>
          <!-- 3-D bottom edge -->
          <ellipse cx="28" cy="51" rx="24" ry="4.5" fill="url(#cEdge)"/>
          <!-- Side shading -->
          <path d="M4 28 Q3.5 47 28 51 Q5 46 4 28Z" fill="rgba(0,0,0,0.18)"/>
          <!-- Face -->
          <circle cx="28" cy="25" r="24" fill="url(#cFace)"/>
          <!-- Inner ring -->
          <circle cx="28" cy="25" r="19" fill="none" stroke="rgba(160,90,10,0.4)" stroke-width="1.2"/>
          <!-- ₿ symbol via path-like approach with text -->
          <text x="28" y="33" text-anchor="middle" font-size="22" font-weight="900"
                fill="rgba(90,42,0,0.9)" font-family="Inter,Arial,sans-serif">&#x20BF;</text>
          <!-- Face highlight -->
          <ellipse cx="19" cy="15" rx="8.5" ry="5"
                   fill="rgba(255,255,255,0.32)" transform="rotate(-20 19 15)"/>
        </svg>
      </div>
    {/if}

  </div><!-- /gs-stage -->
</div><!-- /gs-root -->


<!-- ═══════════════════════════════════════════════════════════════════════════
     STYLES  — all GPU-accelerated; no layout-triggering properties animated
     ═══════════════════════════════════════════════════════════════════════════ -->
<style>
  /* ── Root: fixed overlay covering full viewport — pure black + teal glow ── */
  .gs-root {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
    background:
      radial-gradient(ellipse 90% 45% at 50% 0%, rgba(0, 160, 140, 0.18) 0%, transparent 62%),
      #000000;
  }

  /* ── Upper content block ─────────────────────────────────────────────────── */
  .gs-content {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 32px 24px 20px;
    width: 100%;
    box-sizing: border-box;
    text-align: center;
  }

  /* ── Logo + glow ─────────────────────────────────────────────────────────── */
  .gs-logo-wrap {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 12px;
    /* Reserve room for the glow to bleed without causing layout shift */
    padding: 16px;
  }

  .gs-glow {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: radial-gradient(
      ellipse 80% 80% at 50% 50%,
      rgba(230, 196, 53, 0.35) 0%,
      rgba(0, 210, 184, 0.16) 45%,
      transparent 72%
    );
    opacity: 0.7;
    transform-origin: center;
    will-change: transform, opacity;
  }
  .gs-glow--pulse {
    animation: glowCollect 0.45s ease-out forwards;
  }

  @keyframes glowCollect {
    0%   { transform: scale(1);   opacity: 0.7; }
    40%  { transform: scale(1.6); opacity: 1;   }
    100% { transform: scale(1.2); opacity: 0.8; }
  }

  .gs-logo {
    position: relative;
    z-index: 1;
    width: 72px;
    height: 72px;
    object-fit: contain;
    will-change: transform;
    /* transform is driven by the Svelte spring store inline */
  }

  /* ── Text ────────────────────────────────────────────────────────────────── */
  .gs-brand {
    font-size: 13px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.55);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 0 0 4px;
  }
  .gs-title {
    font-size: 26px;
    font-weight: 700;
    color: #ffffff;
    margin: 0 0 8px;
    line-height: 1.2;
  }
  .gs-cta {
    font-size: 13px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.50);
    margin: 0 0 24px;
    line-height: 1.5;
    max-width: 240px;
  }

  /* ── Bind wallet button ──────────────────────────────────────────────────── */
  .gs-bind-btn {
    width: 100%;
    max-width: 220px;
    min-height: 44px;
    padding: 12px 20px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.07);
    color: #ffffff;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    backdrop-filter: blur(8px) saturate(140%);
    -webkit-backdrop-filter: blur(8px) saturate(140%);
    transition: background 0.18s ease, transform 0.12s ease;
    will-change: transform;
  }
  .gs-bind-btn:hover {
    background: rgba(255, 255, 255, 0.13);
    transform: translateY(-1px);
  }
  .gs-bind-btn:active {
    transform: translateY(0);
  }

  /* ── Bottom stage (animation arena) ─────────────────────────────────────── */
  .gs-stage {
    position: relative;
    flex: 1;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    width: 100%;
    min-height: 130px;
    overflow: visible; /* coin needs to fly above this container */
    z-index: 1;
    padding-bottom: 24px;
    box-sizing: border-box;
  }

  /* ════════════════════════════════════════════════════════════════════════════
     QUESTION MARK BLOCK
     ════════════════════════════════════════════════════════════════════════════ */
  .gs-block {
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    width: 64px;
    height: 64px;
    will-change: transform, opacity;
    cursor: pointer;
    transition: transform 0.12s ease;
    outline: none;
  }
  .gs-block:hover {
    transform: translateX(-50%) translateY(-3px) scale(1.06);
  }
  .gs-block:active {
    transform: translateX(-50%) translateY(1px) scale(0.94);
  }
  .gs-block-depth {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    filter: drop-shadow(0 6px 14px rgba(0,0,0,0.7))
            drop-shadow(0 2px 4px rgba(230,196,53,0.2));
  }

  /* Overlay precisely covers the SVG front face rect: x=6 y=6 w=58 h=58 */
  /* (The .gs-block is 64×64px matching the SVG viewBox 0 0 64 64)          */
  .gs-block-front {
    position: absolute;
    left: 6px;
    top: 6px;
    width: 58px;
    height: 58px;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .gs-block-qmark {
    display: block;
    font-size: 32px;
    font-weight: 900;
    line-height: 1;
    color: #E6C435;
    font-family: Inter, Arial, sans-serif;
    text-shadow: 0 2px 8px rgba(230, 196, 53, 0.6);
    /* Sans-serif glyphs carry ~8% baseline padding below the cap-height;
       this nudge compensates so the "?" sits visually centred in the face. */
    transform: translateY(-4%);
    user-select: none;
  }

  /* ════════════════════════════════════════════════════════════════════════════
     EXPLOSION PARTICLES (8 shards)
     CSS custom-property trick: each .gs-particle--N gets unique angle/distance
     via a data attribute approach using sequential nth-child selectors.
     All transforms are GPU-only (translate + rotate).
     ════════════════════════════════════════════════════════════════════════════ */
  .gs-particles {
    position: absolute;
    bottom: 54px; /* aligned to block centre */
    left: 50%;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .gs-particle {
    position: absolute;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    background: #3a3a3a;
    border: 1px solid #555;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.1);
    transform-origin: center;
    will-change: transform, opacity;
  }

  /* Individual particle trajectories — 8 directions at 45° intervals */
  .gs-particle--0 { animation: particle0 0.35s cubic-bezier(0.1, 0.6, 0.4, 1) forwards; }
  .gs-particle--1 { animation: particle1 0.38s cubic-bezier(0.1, 0.6, 0.4, 1) forwards; }
  .gs-particle--2 { animation: particle2 0.32s cubic-bezier(0.1, 0.6, 0.4, 1) forwards; }
  .gs-particle--3 { animation: particle3 0.36s cubic-bezier(0.1, 0.6, 0.4, 1) forwards; }
  .gs-particle--4 { animation: particle4 0.33s cubic-bezier(0.1, 0.6, 0.4, 1) forwards; background:#555; }
  .gs-particle--5 { animation: particle5 0.40s cubic-bezier(0.1, 0.6, 0.4, 1) forwards; background:#2a2a2a; }
  .gs-particle--6 { animation: particle6 0.34s cubic-bezier(0.1, 0.6, 0.4, 1) forwards; }
  .gs-particle--7 { animation: particle7 0.37s cubic-bezier(0.1, 0.6, 0.4, 1) forwards; background:#444; }

  @keyframes particle0 {
    0%   { transform: translate3d(0,0,0)           rotate(0deg);    opacity: 1; }
    100% { transform: translate3d(-4px,-68px,0)    rotate(-180deg); opacity: 0; }
  }
  @keyframes particle1 {
    0%   { transform: translate3d(0,0,0)           rotate(0deg);    opacity: 1; }
    100% { transform: translate3d(52px,-52px,0)    rotate(120deg);  opacity: 0; }
  }
  @keyframes particle2 {
    0%   { transform: translate3d(0,0,0)           rotate(0deg);    opacity: 1; }
    100% { transform: translate3d(72px,-8px,0)     rotate(90deg);   opacity: 0; }
  }
  @keyframes particle3 {
    0%   { transform: translate3d(0,0,0)           rotate(0deg);    opacity: 1; }
    100% { transform: translate3d(48px,44px,0)     rotate(200deg);  opacity: 0; }
  }
  @keyframes particle4 {
    0%   { transform: translate3d(0,0,0)           rotate(0deg);    opacity: 1; }
    100% { transform: translate3d(2px,58px,0)      rotate(-90deg);  opacity: 0; }
  }
  @keyframes particle5 {
    0%   { transform: translate3d(0,0,0)           rotate(0deg);    opacity: 1; }
    100% { transform: translate3d(-50px,42px,0)    rotate(240deg);  opacity: 0; }
  }
  @keyframes particle6 {
    0%   { transform: translate3d(0,0,0)           rotate(0deg);    opacity: 1; }
    100% { transform: translate3d(-70px,-6px,0)    rotate(-120deg); opacity: 0; }
  }
  @keyframes particle7 {
    0%   { transform: translate3d(0,0,0)           rotate(0deg);    opacity: 1; }
    100% { transform: translate3d(-50px,-54px,0)   rotate(160deg);  opacity: 0; }
  }

  /* ════════════════════════════════════════════════════════════════════════════
     BITCOIN COIN — three-phase flight path
     Phase 1 (releasing)  : fast upward pop from the block
     Phase 2 (journeying) : arc/curve toward the logo at top-centre
     Phase 3 (collecting) : final deceleration + scale-down fade into glow

     Coordinates are viewport-relative via absolute positioning inside gs-stage.
     The logo sits ~(50%, top:~140px from viewport top); the stage bottom is
     ~24px from the viewport bottom, so the coin must travel ≈460px upward.
     ════════════════════════════════════════════════════════════════════════════ */
  .gs-coin {
    position: absolute;
    bottom: 44px; /* aligned over block centre */
    left: 50%;
    width: 52px;
    height: 52px;
    margin-left: -26px; /* centre horizontally */
    pointer-events: none;
    will-change: transform, opacity;
    transform-origin: center center;
    transform-style: preserve-3d;
  }
  .gs-coin-svg {
    display: block;
    width: 100%;
    height: 100%;
    filter: drop-shadow(0 4px 12px rgba(247,208,54,0.55));
  }

  /* ── Phase 1: rapid upward pop from block ────────────────────────────────── */
  .gs-coin--releasing {
    animation: coinRelease 0.22s cubic-bezier(0.2, 1.5, 0.4, 1) forwards;
  }
  @keyframes coinRelease {
    0%   { transform: translate3d(0,0,0)     rotateY(0deg)   scale(0.7);  opacity: 0; }
    30%  { transform: translate3d(0,-28px,0) rotateY(90deg)  scale(1.05); opacity: 1; }
    100% { transform: translate3d(0,-80px,0) rotateY(180deg) scale(1);    opacity: 1; }
  }

  /* ── Phase 2: arc up toward the logo (~460px from bottom of stage) ───────── */
  .gs-coin--journeying {
    animation: coinJourney 0.46s cubic-bezier(0.3, 0, 0.2, 1) forwards;
    transform: translate3d(0,-80px,0) rotateY(180deg);
  }
  @keyframes coinJourney {
    0%   { transform: translate3d(0,-80px,0)     rotateY(180deg)  scale(1);    opacity: 1; }
    35%  { transform: translate3d(12px,-220px,0) rotateY(540deg)  scale(0.95); opacity: 1; }
    75%  { transform: translate3d(4px,-370px,0)  rotateY(900deg)  scale(0.85); opacity: 1; }
    100% { transform: translate3d(0,-450px,0)    rotateY(1080deg) scale(0.7);  opacity: 1; }
  }

  /* ── Phase 3: coin collides with logo, scale-fades into glow ────────────── */
  .gs-coin--collecting {
    animation: coinCollect 0.48s cubic-bezier(0.4, 0, 0.6, 1) forwards;
    transform: translate3d(0,-450px,0) rotateY(1080deg) scale(0.7);
  }
  @keyframes coinCollect {
    0%   { transform: translate3d(0,-450px,0) scale(0.7) rotateY(1080deg); opacity: 1;   }
    50%  { transform: translate3d(0,-470px,0) scale(0.3) rotateY(1080deg); opacity: 0.7; }
    100% { transform: translate3d(0,-480px,0) scale(0)   rotateY(1080deg); opacity: 0;   }
  }
</style>
