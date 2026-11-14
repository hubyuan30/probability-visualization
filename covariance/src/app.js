(() => {
  'use strict';

  /* ------------------------------------------------------------
     helpers
  ------------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const meanOf = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);

  const C = {
    ink: '#17211d',
    ink2: '#2a3832',
    muted: '#66716a',
    faint: '#96a098',
    line: '#ded9cc',
    surface: '#fffdf7',
    teal: '#0c7c68',
    coral: '#c95a3c',
    amber: '#dda02e',
    tealLight: '#5edfc3',
    coralLight: '#ff9f7d',
    cream: '#f5f0e3'
  };
  const FONT_UI = '"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif';
  const FONT_MONO = '"Cascadia Code",Consolas,"SFMono-Regular",monospace';
  const FONT_SERIF = 'Georgia,"Times New Roman","Songti SC",serif';

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rng) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }

  function centerStandardize(arr) {
    const m = meanOf(arr);
    let ss = 0;
    for (let i = 0; i < arr.length; i++) {
      arr[i] -= m;
      ss += arr[i] * arr[i];
    }
    const sd = Math.sqrt(ss / arr.length) || 1;
    for (let i = 0; i < arr.length; i++) arr[i] /= sd;
    return arr;
  }

  // A pair of sample vectors with mean 0, sample variance 1 and zero sample covariance.
  function orthogonalBases(n, seed) {
    const rng = mulberry32(seed);
    const a = [];
    const b = [];
    for (let i = 0; i < n; i++) {
      a.push(gaussian(rng));
      b.push(gaussian(rng));
    }
    centerStandardize(a);
    centerStandardize(b);

    let dot = 0;
    let aa = 0;
    for (let i = 0; i < n; i++) {
      dot += a[i] * b[i];
      aa += a[i] * a[i];
    }
    const k = dot / (aa || 1);
    for (let i = 0; i < n; i++) b[i] -= k * a[i];
    centerStandardize(b);

    return a.map((v, i) => ({ a: v, b: b[i] }));
  }

  function f2(v) {
    if (!Number.isFinite(v)) return '—';
    let s = v.toFixed(2);
    if (s === '-0.00') s = '0.00';
    return s;
  }

  function sf2(v) {
    if (!Number.isFinite(v)) return '—';
    const s = f2(v);
    return v > 0.005 ? '+' + s : s;
  }

  function signClass(v, eps = 0.005) {
    return v > eps ? 'pos' : v < -eps ? 'neg' : 'zero';
  }

  function calcStats(points) {
    const n = points.length;
    if (!n) {
      return { n: 0, mx: 0, my: 0, sum: 0, cov: 0, vx: 0, vy: 0, r: 0, pos: 0, neg: 0, items: [] };
    }
    let mx = 0;
    let my = 0;
    for (const p of points) {
      mx += p.x;
      my += p.y;
    }
    mx /= n;
    my /= n;

    let sum = 0;
    let vx = 0;
    let vy = 0;
    let pos = 0;
    let neg = 0;
    const items = new Array(n);

    for (let i = 0; i < n; i++) {
      const dx = points[i].x - mx;
      const dy = points[i].y - my;
      const prod = dx * dy;
      sum += prod;
      vx += dx * dx;
      vy += dy * dy;
      if (prod > 1e-9) pos++;
      else if (prod < -1e-9) neg++;
      items[i] = { dx, dy, prod };
    }
    const cov = sum / n;
    vx /= n;
    vy /= n;
    const r = vx > 1e-12 && vy > 1e-12 ? cov / Math.sqrt(vx * vy) : 0;
    return { n, mx, my, sum, cov, vx, vy, r, pos, neg, items };
  }

  function mountCanvas(canvas, wrap, draw) {
    const ctx = canvas.getContext('2d');
    const state = { ctx, w: 0, h: 0, dpr: 1 };

    function resize() {
      const rect = wrap.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.w = w;
      state.h = h;
      state.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(state);
    }

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(resize);
      ro.observe(wrap);
    } else {
      window.addEventListener('resize', resize);
    }
    resize();
    return state;
  }

  function clipPlot(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
  }

  /* ------------------------------------------------------------
     02 · drag lab
  ------------------------------------------------------------ */
  const labCanvas = $('#labCanvas');
  const labWrap = $('#labWrap');
  const labTip = $('#labTip');
  const playBadge = $('#playBadge');
  const playBtn = $('#playBtn');
  const addPointBtn = $('#addPoint');
  const rectToggle = $('#rectToggle');
  const covBig = $('#covBig');
  const covStatus = $('#covStatus');
  const varXEl = $('#varX');
  const varYEl = $('#varY');
  const rBig = $('#rBig');
  const rDot = $('#rDot');
  const eqLine = $('#eqLine');
  const signNote = $('#signNote');
  const contribList = $('#contribList');

  const labState = {
    points: [],
    preset: 'positive',
    hover: -1,
    drag: -1,
    showRects: true,
    playing: false,
    playIndex: 0,
    playSum: 0,
    playTimer: null,
    rows: [],
    geom: null,
    lastStats: null
  };

  function makeLabPreset(kind) {
    const seeds = { positive: 19, negative: 3, zero: 3037, quadratic: 4051 };
    const rng = mulberry32(seeds[kind] || 19);
    const n = kind === 'quadratic' ? 11 : 10;
    const pts = [];

    if (kind === 'quadratic') {
      for (let i = 0; i < n; i++) {
        const x = -2.8 + (i * 5.6) / (n - 1) + (rng() - 0.5) * 0.38;
        const y = 0.52 * x * x - 1.95 + (rng() - 0.5) * 0.25;
        pts.push({ x, y });
      }
    } else {
      for (let i = 0; i < n; i++) {
        const x = gaussian(rng);
        const noise = gaussian(rng);
        let y;
        if (kind === 'positive') y = 0.95 * x + 0.62 * noise;
        else if (kind === 'negative') y = -0.95 * x + 0.62 * noise;
        else y = noise;
        pts.push({ x, y });
      }
    }

    // Center the cloud on its own mean.
    const mx = meanOf(pts.map((p) => p.x));
    const my = meanOf(pts.map((p) => p.y));
    for (const p of pts) {
      p.x -= mx;
      p.y -= my;
    }

    // For the "almost independent" preset, make the sample covariance exactly zero.
    if (kind === 'zero') {
      let sxy = 0;
      let sxx = 0;
      for (const p of pts) {
        sxy += p.x * p.y;
        sxx += p.x * p.x;
      }
      const k = sxy / (sxx || 1);
      for (const p of pts) p.y -= k * p.x;
    }

    const sx = Math.sqrt(meanOf(pts.map((p) => p.x * p.x))) || 1;
    const sy = Math.sqrt(meanOf(pts.map((p) => p.y * p.y))) || 1;
    const targetX = 1.62;
    const targetY = kind === 'quadratic' ? 1.42 : 1.48;

    return pts.map((p) => ({
      x: clamp((p.x / sx) * targetX, -4.05, 4.05),
      y: clamp((p.y / sy) * targetY, -4.05, 4.05)
    }));
  }

  function buildContribRows() {
    labState.rows = [];
    contribList.innerHTML = '';
    labState.points.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'contrib';
      row.tabIndex = 0;
      row.innerHTML =
        '<span class="contrib-idx">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="contrib-bar"><i></i></span>' +
        '<span class="contrib-val"></span>';

      const enter = () => {
        if (labState.drag >= 0) return;
        labState.hover = i;
        if (labStage) drawLab(labStage);
        showLabTip(i);
      };
      const leave = () => {
        if (labState.drag >= 0) return;
        if (labState.hover === i) {
          labState.hover = -1;
          if (labStage) drawLab(labStage);
          hideLabTip();
        }
      };

      row.addEventListener('pointerenter', enter);
      row.addEventListener('pointerleave', leave);
      row.addEventListener('focus', enter);
      row.addEventListener('blur', leave);
      contribList.appendChild(row);
      labState.rows.push({
        row,
        bar: row.querySelector('.contrib-bar i'),
        val: row.querySelector('.contrib-val')
      });
    });
  }

  function syncLabUI(st) {
    const covCls = signClass(st.cov, 0.005);
    covBig.textContent = sf2(st.cov);
    covBig.className = 'stat-big ' + covCls;

    const neutral = Math.abs(st.r) < 0.08;
    covStatus.textContent = neutral ? '几乎没有线性趋势' : st.r > 0 ? '正相关趋势' : '负相关趋势';
    covStatus.className = 'status-pill ' + (neutral ? 'zero' : signClass(st.r, 0));

    varXEl.textContent = f2(st.vx);
    varYEl.textContent = f2(st.vy);
    rBig.textContent = sf2(st.r);
    rDot.style.left = clamp(((st.r + 1) / 2) * 100, 2, 98) + '%';
    rDot.style.background = st.r >= 0 ? C.teal : C.coral;
    eqLine.textContent = 'Σ(dx·dy) / n = ' + sf2(st.sum) + ' / ' + st.n + ' = ' + sf2(st.cov);

    let note = st.pos + ' 个正贡献，' + st.neg + ' 个负贡献';
    if (neutral) note += ' · 正负几乎抵消';
    else if (st.r > 0) note += ' · 同号占多数';
    else note += ' · 异号占多数';
    signNote.textContent = note;

    let maxAbs = 0.0001;
    for (const it of st.items) maxAbs = Math.max(maxAbs, Math.abs(it.prod));

    labState.rows.forEach((row, i) => {
      const it = st.items[i];
      if (!it) return;
      const widthPct = Math.max(1.5, (Math.abs(it.prod) / maxAbs) * 50);
      row.bar.style.width = widthPct + '%';
      row.bar.style.left = (it.prod >= 0 ? 50 : 50 - widthPct) + '%';
      row.bar.className = it.prod >= 0 ? 'pos' : 'neg';
      row.val.textContent = sf2(it.prod);
      row.val.className = 'contrib-val ' + (it.prod >= 0 ? 'pos' : 'neg');
      row.row.className = 'contrib' + (i === labState.hover ? ' active' : '');
      row.row.setAttribute('aria-label', '第 ' + (i + 1) + ' 个点，贡献 ' + sf2(it.prod));
    });
  }

  function drawLab(s) {
    const ctx = s.ctx;
    const w = s.w;
    const h = s.h;
    ctx.clearRect(0, 0, w, h);

    const st = calcStats(labState.points);
    labState.lastStats = st;

    const pad = { l: 24, r: 20, t: 22, b: 24 };
    const plotW = Math.max(1, w - pad.l - pad.r);
    const plotH = Math.max(1, h - pad.t - pad.b);
    const domain = 4.4;
    const X = (x) => pad.l + ((x + domain) / (domain * 2)) * plotW;
    const Y = (y) => h - pad.b - ((y + domain) / (domain * 2)) * plotH;
    const mx = X(st.mx);
    const my = Y(st.my);
    labState.geom = { X, Y, pad, plotW, plotH, domain, w, h };

    ctx.save();
    clipPlot(ctx, pad.l, pad.t, plotW, plotH);

    // Quadrant tints, relative to the current mean.
    const rightW = Math.max(0, pad.l + plotW - mx);
    const leftW = Math.max(0, mx - pad.l);
    const topH = Math.max(0, my - pad.t);
    const botH = Math.max(0, pad.t + plotH - my);

    ctx.fillStyle = 'rgba(12,124,104,.032)';
    if (rightW > 0 && topH > 0) ctx.fillRect(mx, pad.t, rightW, topH);
    if (leftW > 0 && botH > 0) ctx.fillRect(pad.l, my, leftW, botH);
    ctx.fillStyle = 'rgba(201,90,60,.028)';
    if (leftW > 0 && topH > 0) ctx.fillRect(pad.l, pad.t, leftW, topH);
    if (rightW > 0 && botH > 0) ctx.fillRect(mx, my, rightW, botH);

    // Quiet unit grid.
    ctx.strokeStyle = 'rgba(23,33,29,.045)';
    ctx.lineWidth = 1;
    for (let i = -4; i <= 4; i++) {
      const gx = Math.round(X(i)) + 0.5;
      const gy = Math.round(Y(i)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, pad.t);
      ctx.lineTo(gx, pad.t + plotH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(pad.l + plotW, gy);
      ctx.stroke();
    }

    // Signed rectangles.
    if (labState.showRects) {
      st.items.forEach((it, i) => {
        const p = labState.points[i];
        const px = X(p.x);
        const py = Y(p.y);
        const x0 = Math.min(mx, px);
        const y0 = Math.min(my, py);
        const rw = Math.abs(px - mx);
        const rh = Math.abs(py - my);
        if (rw < 0.6 || rh < 0.6) return;

        const active = i === labState.hover;
        const dim = labState.playing && !active;
        const positive = it.prod >= 0;
        const fillAlpha = dim ? 0.014 : active ? 0.17 : 0.043;
        const strokeAlpha = dim ? 0.05 : active ? 0.72 : 0.28;

        ctx.fillStyle = positive
          ? 'rgba(12,124,104,' + fillAlpha + ')'
          : 'rgba(201,90,60,' + fillAlpha + ')';
        ctx.fillRect(x0, y0, rw, rh);

        ctx.strokeStyle = positive
          ? 'rgba(12,124,104,' + strokeAlpha + ')'
          : 'rgba(201,90,60,' + strokeAlpha + ')';
        ctx.lineWidth = active ? 1.5 : 1;
        ctx.setLineDash(active ? [] : [4, 4]);
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(0, rw - 1), Math.max(0, rh - 1));
        ctx.setLineDash([]);
      });
    }

    // Mean lines.
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(23,33,29,.34)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx, pad.t);
    ctx.lineTo(mx, pad.t + plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pad.l, my);
    ctx.lineTo(pad.l + plotW, my);
    ctx.stroke();
    ctx.setLineDash([]);

    // Small quadrant marks.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 14px ' + FONT_SERIF;
    const marks = [
      ['+', pad.l + plotW - 17, pad.t + 17, 'rgba(12,124,104,.26)'],
      ['−', pad.l + 17, pad.t + 17, 'rgba(201,90,60,.23)'],
      ['+', pad.l + 17, pad.t + plotH - 17, 'rgba(12,124,104,.26)'],
      ['−', pad.l + plotW - 17, pad.t + plotH - 17, 'rgba(201,90,60,.23)']
    ];
    for (const [txt, x, y, color] of marks) {
      ctx.fillStyle = color;
      ctx.fillText(txt, x, y);
    }

    // Points and their hover halo.
    st.items.forEach((it, i) => {
      const p = labState.points[i];
      const px = X(p.x);
      const py = Y(p.y);
      const active = i === labState.hover;
      const dim = labState.playing && !active;
      const color = it.prod > 1e-9 ? C.teal : it.prod < -1e-9 ? C.coral : '#8b948d';

      if (active) {
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, 17, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.globalAlpha = dim ? 0.27 : labState.hover >= 0 && !active ? 0.78 : 1;
      ctx.beginPath();
      ctx.arc(px, py, active ? 8 : 6.4, 0, TAU);
      ctx.fillStyle = color;
      ctx.shadowColor = 'rgba(23,33,29,.16)';
      ctx.shadowBlur = 7;
      ctx.shadowOffsetY = 2;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.surface;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // Mean cross.
    ctx.strokeStyle = 'rgba(23,33,29,.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx - 8, my);
    ctx.lineTo(mx + 8, my);
    ctx.moveTo(mx, my - 8);
    ctx.lineTo(mx, my + 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, 4, 0, TAU);
    ctx.fillStyle = C.surface;
    ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.restore();

    // Labels outside the clipped plot.
    ctx.font = '500 10px ' + FONT_MONO;
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('x̄', clamp(mx + 5, pad.l, pad.l + plotW - 14), pad.t + 11);
    ctx.textAlign = 'right';
    ctx.fillText('ȳ', clamp(pad.l - 4, 3, w - 4), clamp(my - 5, pad.t + 10, pad.t + plotH));

    ctx.font = '500 8.5px ' + FONT_MONO;
    ctx.fillStyle = 'rgba(23,33,29,.32)';
    ctx.textAlign = 'right';
    ctx.fillText('X →', pad.l + plotW, h - 5);
    ctx.textAlign = 'left';
    ctx.fillText('Y ↑', 4, pad.t + 9);

    syncLabUI(st);
  }

  function pointerPosOnLab(e) {
    const rect = labCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  const LAB_HIT_R = window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 26 : 18;

  function pickLabPoint(px, py) {
    const g = labState.geom;
    if (!g) return -1;
    let best = -1;
    let bestD = LAB_HIT_R * LAB_HIT_R;
    labState.points.forEach((p, i) => {
      const dx = g.X(p.x) - px;
      const dy = g.Y(p.y) - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function labDataFromPixels(px, py) {
    const g = labState.geom;
    if (!g) return { x: 0, y: 0 };
    let x = ((px - g.pad.l) / g.plotW) * 2 * g.domain - g.domain;
    let y = g.domain - ((py - g.pad.t) / g.plotH) * 2 * g.domain;
    x = Math.round(x * 20) / 20;
    y = Math.round(y * 20) / 20;
    return { x: clamp(x, -4.15, 4.15), y: clamp(y, -4.15, 4.15) };
  }

  function showLabTip(i) {
    const g = labState.geom;
    if (!g || i < 0 || i >= labState.points.length) {
      hideLabTip();
      return;
    }
    const st = labState.lastStats || calcStats(labState.points);
    const it = st.items[i];
    const p = labState.points[i];
    if (!it) {
      hideLabTip();
      return;
    }
    const px = g.X(p.x);
    const py = g.Y(p.y);
    const below = py < 75;
    const margin = Math.min(100, Math.max(45, g.w / 2 - 8));

    labTip.classList.toggle('below', below);
    labTip.style.left = clamp(px, margin, g.w - margin) + 'px';
    labTip.style.top = clamp(py, 18, g.h - 18) + 'px';
    labTip.innerHTML =
      '<span class="tip-muted">点 ' + (i + 1) + '</span><br>' +
      '<b>dx = ' + sf2(it.dx) + '</b> · <b>dy = ' + sf2(it.dy) + '</b><br>' +
      '乘积 <span class="' + (it.prod >= 0 ? 'tip-pos' : 'tip-neg') + '">' + sf2(it.prod) +
      '</span> <span class="tip-muted">' + (it.prod >= 0 ? '正贡献' : '负贡献') + '</span>';
    labTip.hidden = false;
  }

  function hideLabTip() {
    labTip.hidden = true;
  }

  function stopLabPlay(silent) {
    if (labState.playTimer) {
      clearTimeout(labState.playTimer);
      labState.playTimer = null;
    }
    const was = labState.playing;
    labState.playing = false;
    labState.hover = -1;
    playBtn.textContent = '▶ 逐点累加';
    playBadge.hidden = true;
    if (!silent && was && labStage) drawLab(labStage);
  }

  function labPlayStep() {
    labState.playTimer = null;
    if (!labState.playing) return;

    const st = calcStats(labState.points);
    if (labState.playIndex >= st.n) {
      labState.playing = false;
      labState.hover = -1;
      playBtn.textContent = '▶ 逐点累加';
      if (labStage) drawLab(labStage);
      playBadge.textContent = '完成 · Cov(X,Y) = ' + sf2(st.cov);
      playBadge.hidden = false;
      labState.playTimer = setTimeout(() => {
        playBadge.hidden = true;
        labState.playTimer = null;
      }, 1600);
      return;
    }

    const it = st.items[labState.playIndex];
    labState.playSum += it.prod;
    const count = labState.playIndex + 1;
    labState.hover = labState.playIndex;
    labState.playIndex++;
    playBadge.textContent =
      '逐点累加 ' + count + '/' + st.n + ' · 当前平均 ' + sf2(labState.playSum / count);
    playBadge.hidden = false;
    if (labStage) drawLab(labStage);
    labState.playTimer = setTimeout(labPlayStep, 620);
  }

  function startLabPlay() {
    labState.playing = true;
    labState.playIndex = 0;
    labState.playSum = 0;
    playBtn.textContent = '■ 停止';
    labPlayStep();
  }

  labState.points = makeLabPreset('positive');
  buildContribRows();
  const labStage = mountCanvas(labCanvas, labWrap, drawLab);

  labCanvas.addEventListener('pointerdown', (e) => {
    const pos = pointerPosOnLab(e);
    const idx = pickLabPoint(pos.x, pos.y);
    if (idx < 0) return;
    if (labState.playing) stopLabPlay(true);
    e.preventDefault();
    labState.drag = idx;
    labState.hover = idx;
    labCanvas.classList.add('dragging');
    labCanvas.style.cursor = 'grabbing';
    try {
      labCanvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    drawLab(labStage);
    showLabTip(idx);
  });

  labCanvas.addEventListener('pointermove', (e) => {
    const pos = pointerPosOnLab(e);
    if (labState.drag >= 0) {
      const data = labDataFromPixels(pos.x, pos.y);
      const p = labState.points[labState.drag];
      p.x = data.x;
      p.y = data.y;
      drawLab(labStage);
      showLabTip(labState.drag);
      return;
    }
    const idx = pickLabPoint(pos.x, pos.y);
    labCanvas.style.cursor = idx >= 0 ? 'grab' : 'default';
    if (idx !== labState.hover) {
      labState.hover = idx;
      drawLab(labStage);
      if (idx >= 0) showLabTip(idx);
      else hideLabTip();
    }
  });

  function endLabDrag(e) {
    if (labState.drag < 0) return;
    labState.drag = -1;
    labCanvas.classList.remove('dragging');
    labCanvas.style.cursor = 'grab';
    if (e && labCanvas.hasPointerCapture && labCanvas.hasPointerCapture(e.pointerId)) {
      labCanvas.releasePointerCapture(e.pointerId);
    }
    labState.hover = -1;
    hideLabTip();
    drawLab(labStage);
  }

  labCanvas.addEventListener('pointerup', endLabDrag);
  labCanvas.addEventListener('pointercancel', endLabDrag);
  labCanvas.addEventListener('pointerleave', () => {
    if (labState.drag >= 0) return;
    labState.hover = -1;
    labCanvas.style.cursor = 'grab';
    hideLabTip();
    drawLab(labStage);
  });

  $$('.preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      stopLabPlay(true);
      labState.preset = btn.dataset.preset;
      labState.points = makeLabPreset(labState.preset);
      labState.hover = -1;
      labState.drag = -1;
      $$('.preset').forEach((b) => b.classList.toggle('is-active', b === btn));
      buildContribRows();
      hideLabTip();
      addPointBtn.disabled = labState.points.length >= 14;
      drawLab(labStage);
    });
  });

  $('#resetA').addEventListener('click', () => {
    stopLabPlay(true);
    labState.points = makeLabPreset(labState.preset);
    labState.hover = -1;
    labState.drag = -1;
    labCanvas.classList.remove('dragging');
    labCanvas.style.cursor = 'grab';
    buildContribRows();
    hideLabTip();
    addPointBtn.disabled = labState.points.length >= 14;
    drawLab(labStage);
  });

  addPointBtn.addEventListener('click', () => {
    if (labState.points.length >= 14) return;
    stopLabPlay(true);
    const angle = Math.random() * TAU;
    const radius = 0.9 + Math.random() * 2.5;
    labState.points.push({
      x: clamp(Math.cos(angle) * radius, -3.9, 3.9),
      y: clamp(Math.sin(angle) * radius, -3.9, 3.9)
    });
    labState.hover = -1;
    buildContribRows();
    contribList.scrollTop = contribList.scrollHeight;
    hideLabTip();
    addPointBtn.disabled = labState.points.length >= 14;
    drawLab(labStage);
  });

  rectToggle.addEventListener('change', () => {
    labState.showRects = rectToggle.checked;
    drawLab(labStage);
  });

  playBtn.addEventListener('click', () => {
    if (labState.playing) {
      stopLabPlay();
    } else {
      stopLabPlay(true);
      startLabPlay();
    }
  });

  /* ------------------------------------------------------------
     03 · correlation lab
  ------------------------------------------------------------ */
  const rhoCanvas = $('#rhoCanvas');
  const rhoWrap = $('#rhoWrap');
  const rhoSlider = $('#rhoSlider');
  const sigmaX = $('#sigmaX');
  const sigmaY = $('#sigmaY');
  const rhoVal = $('#rhoVal');
  const sigmaXVal = $('#sigmaXVal');
  const sigmaYVal = $('#sigmaYVal');
  const rhoChip = $('#rhoChip');
  const rhoCov = $('#rhoCov');
  const rhoR = $('#rhoR');
  const rhoIdentity = $('#rhoIdentity');
  const mVarX = $('#mVarX');
  const mCov1 = $('#mCov1');
  const mCov2 = $('#mCov2');
  const mVarY = $('#mVarY');

  const rhoBase = orthogonalBases(260, 8675309);
  const rhoState = {
    rho: 0.85,
    sx: 1.6,
    sy: 1.2,
    points: []
  };

  function paintRange(input) {
    if (!input) return;
    const min = Number(input.min);
    const max = Number(input.max);
    const val = Number(input.value);
    const pct = ((val - min) / (max - min)) * 100;
    input.style.setProperty('--p', pct + '%');
  }

  function buildRhoPoints() {
    const k = Math.sqrt(Math.max(0, 1 - rhoState.rho * rhoState.rho));
    rhoState.points = rhoBase.map(({ a, b }) => ({
      x: rhoState.sx * a,
      y: rhoState.sy * (rhoState.rho * a + k * b)
    }));
  }

  function syncRhoUI() {
    const st = calcStats(rhoState.points);
    const covCls = signClass(st.cov, 0.005);
    const rCls = signClass(st.r, 0.005);

    rhoCov.textContent = sf2(st.cov);
    rhoCov.className = covCls;
    rhoR.textContent = sf2(st.r);
    rhoR.className = rCls;

    rhoChip.innerHTML =
      '<span class="rho-caret" style="background:' +
      (st.r > 0.005 ? C.teal : st.r < -0.005 ? C.coral : C.faint) +
      '"></span>ρ = ' + sf2(rhoState.rho);

    rhoVal.textContent = sf2(rhoState.rho);
    sigmaXVal.textContent = f2(rhoState.sx);
    sigmaYVal.textContent = f2(rhoState.sy);

    rhoIdentity.textContent =
      'Cov = ρ · σX · σY = ' + f2(rhoState.rho) + ' × ' + f2(rhoState.sx) + ' × ' +
      f2(rhoState.sy) + ' ≈ ' + f2(st.cov);

    mVarX.textContent = f2(st.vx);
    mVarY.textContent = f2(st.vy);
    mCov1.textContent = f2(st.cov);
    mCov2.textContent = f2(st.cov);

    paintRange(sigmaX);
    paintRange(sigmaY);

    $$('.mini-chip').forEach((btn) => {
      btn.classList.toggle('active', Math.abs(Number(btn.dataset.rho) - rhoState.rho) < 0.001);
    });
  }

  function drawRho(s) {
    const ctx = s.ctx;
    const w = s.w;
    const h = s.h;
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 34, r: 24, t: 28, b: 34 };
    const plotW = Math.max(1, w - pad.l - pad.r);
    const plotH = Math.max(1, h - pad.t - pad.b);
    const domain = 7;
    const X = (x) => pad.l + ((x + domain) / (domain * 2)) * plotW;
    const Y = (y) => h - pad.b - ((y + domain) / (domain * 2)) * plotH;
    const ox = X(0);
    const oy = Y(0);

    ctx.save();
    clipPlot(ctx, pad.l, pad.t, plotW, plotH);

    const rightW = Math.max(0, pad.l + plotW - ox);
    const leftW = Math.max(0, ox - pad.l);
    const topH = Math.max(0, oy - pad.t);
    const botH = Math.max(0, pad.t + plotH - oy);
    ctx.fillStyle = 'rgba(12,124,104,.028)';
    if (rightW > 0 && topH > 0) ctx.fillRect(ox, pad.t, rightW, topH);
    if (leftW > 0 && botH > 0) ctx.fillRect(pad.l, oy, leftW, botH);
    ctx.fillStyle = 'rgba(201,90,60,.024)';
    if (leftW > 0 && topH > 0) ctx.fillRect(pad.l, pad.t, leftW, topH);
    if (rightW > 0 && botH > 0) ctx.fillRect(ox, oy, rightW, botH);

    ctx.strokeStyle = 'rgba(23,33,29,.045)';
    ctx.lineWidth = 1;
    for (let v = -6; v <= 6; v += 2) {
      const gx = Math.round(X(v)) + 0.5;
      const gy = Math.round(Y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, pad.t);
      ctx.lineTo(gx, pad.t + plotH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(pad.l + plotW, gy);
      ctx.stroke();
    }

    // 2-sigma covariance ellipse.
    const k = Math.sqrt(Math.max(0, 1 - rhoState.rho * rhoState.rho));
    ctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const t = (i / 160) * TAU;
      const ex = 2 * rhoState.sx * Math.cos(t);
      const ey = 2 * rhoState.sy * (rhoState.rho * Math.cos(t) + k * Math.sin(t));
      const px = X(ex);
      const py = Y(ey);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(12,124,104,.028)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(23,33,29,.23)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Points.
    for (const p of rhoState.points) {
      if (Math.abs(p.x) > domain || Math.abs(p.y) > domain) continue;
      const product = p.x * p.y;
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), 2.35, 0, TAU);
      ctx.fillStyle = product >= 0 ? 'rgba(12,124,104,.62)' : 'rgba(201,90,60,.58)';
      ctx.fill();
    }

    // Mean axes.
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(23,33,29,.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox, pad.t);
    ctx.lineTo(ox, pad.t + plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pad.l, oy);
    ctx.lineTo(pad.l + plotW, oy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(ox, oy, 4, 0, TAU);
    ctx.fillStyle = C.surface;
    ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.font = '500 10px ' + FONT_MONO;
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('EX', ox - 7, oy - 8);
    ctx.textAlign = 'left';
    ctx.fillText('EY', ox + 7, pad.t + 12);

    ctx.restore();

    ctx.font = '500 8.5px ' + FONT_MONO;
    ctx.fillStyle = 'rgba(23,33,29,.33)';
    ctx.textAlign = 'right';
    ctx.fillText('X →', pad.l + plotW, h - 5);
    ctx.textAlign = 'left';
    ctx.fillText('Y ↑', 4, pad.t + 9);
  }

  buildRhoPoints();
  const rhoStage = mountCanvas(rhoCanvas, rhoWrap, drawRho);

  function updateRhoLab() {
    rhoState.rho = Number(rhoSlider.value);
    rhoState.sx = Number(sigmaX.value);
    rhoState.sy = Number(sigmaY.value);
    buildRhoPoints();
    syncRhoUI();
    drawRho(rhoStage);
  }

  rhoSlider.addEventListener('input', updateRhoLab);
  sigmaX.addEventListener('input', updateRhoLab);
  sigmaY.addEventListener('input', updateRhoLab);

  $$('.mini-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      rhoSlider.value = btn.dataset.rho;
      updateRhoLab();
    });
  });

  updateRhoLab();

  /* ------------------------------------------------------------
     U-shape counterexample
  ------------------------------------------------------------ */
  const uCanvas = $('#uCanvas');
  const uCov = $('#uCov');
  const uR = $('#uR');
  const uState = {
    seed: 1234,
    points: [],
    y0: 0
  };

  function makeUData(seed) {
    const rng = mulberry32(seed);
    const pts = [];
    const half = 56;
    for (let i = 0; i < half; i++) {
      const x = 0.12 + (i / (half - 1)) * 2.05;
      const baseY = 0.62 * x * x - 1.3;
      pts.push({ x, y: baseY + (rng() - 0.5) * 0.24 });
      pts.push({ x: -x, y: baseY + (rng() - 0.5) * 0.24 });
    }
    const y0 = meanOf(pts.map((p) => p.y));
    for (const p of pts) p.y -= y0;
    uState.y0 = y0;
    return pts;
  }

  function drawU(s) {
    const ctx = s.ctx;
    const w = s.w;
    const h = s.h;
    ctx.clearRect(0, 0, w, h);

    const st = calcStats(uState.points);
    const pad = { l: 20, r: 14, t: 18, b: 18 };
    const plotW = Math.max(1, w - pad.l - pad.r);
    const plotH = Math.max(1, h - pad.t - pad.b);
    const xHalf = 2.52;
    const yHalf = 2.12;
    const X = (x) => pad.l + ((x + xHalf) / (xHalf * 2)) * plotW;
    const Y = (y) => h - pad.b - ((y + yHalf) / (yHalf * 2)) * plotH;
    const ox = X(st.mx);
    const oy = Y(st.my);

    ctx.save();
    clipPlot(ctx, pad.l, pad.t, plotW, plotH);

    ctx.fillStyle = 'rgba(12,124,104,.03)';
    ctx.fillRect(ox, pad.t, Math.max(0, pad.l + plotW - ox), Math.max(0, oy - pad.t));
    ctx.fillRect(pad.l, oy, Math.max(0, ox - pad.l), Math.max(0, pad.t + plotH - oy));
    ctx.fillStyle = 'rgba(201,90,60,.026)';
    ctx.fillRect(pad.l, pad.t, Math.max(0, ox - pad.l), Math.max(0, oy - pad.t));
    ctx.fillRect(ox, oy, Math.max(0, pad.l + plotW - ox), Math.max(0, pad.t + plotH - oy));

    ctx.strokeStyle = 'rgba(23,33,29,.045)';
    ctx.lineWidth = 1;
    for (let v = -2; v <= 2; v++) {
      const gx = Math.round(X(v)) + 0.5;
      const gy = Math.round(Y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, pad.t);
      ctx.lineTo(gx, pad.t + plotH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(pad.l + plotW, gy);
      ctx.stroke();
    }

    // The true relationship, for reference.
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const x = -2.12 + (i / 120) * 4.24;
      const y = 0.62 * x * x - 1.3 - uState.y0;
      const px = X(x);
      const py = Y(y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = 'rgba(23,33,29,.18)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(23,33,29,.28)';
    ctx.beginPath();
    ctx.moveTo(ox, pad.t);
    ctx.lineTo(ox, pad.t + plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pad.l, oy);
    ctx.lineTo(pad.l + plotW, oy);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const p of uState.points) {
      if (Math.abs(p.x) > xHalf || Math.abs(p.y) > yHalf) continue;
      const product = (p.x - st.mx) * (p.y - st.my);
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), 3.1, 0, TAU);
      ctx.fillStyle = product >= 0 ? 'rgba(12,124,104,.62)' : 'rgba(201,90,60,.54)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,253,247,.8)';
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(ox, oy, 3.5, 0, TAU);
    ctx.fillStyle = C.surface;
    ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.restore();

    ctx.font = '500 8.5px ' + FONT_MONO;
    ctx.fillStyle = 'rgba(23,33,29,.32)';
    ctx.textAlign = 'right';
    ctx.fillText('X →', pad.l + plotW, h - 4);
    ctx.textAlign = 'left';
    ctx.fillText('Y ↑', 3, pad.t + 8);

    uCov.textContent = sf2(st.cov);
    uR.textContent = sf2(st.r);
  }

  uState.points = makeUData(uState.seed);
  const uStage = mountCanvas(uCanvas, uCanvas.parentElement, drawU);

  $('#uResample').addEventListener('click', () => {
    uState.seed = (uState.seed * 1664525 + 1013904223) >>> 0;
    uState.points = makeUData(uState.seed);
    drawU(uStage);
  });

  /* ------------------------------------------------------------
     hero
  ------------------------------------------------------------ */
  const heroCanvas = $('#heroCanvas');
  const heroWrap = $('#heroWrap');
  const heroR = $('#heroR');
  const heroStatus = $('#heroStatus');
  const heroDot = $('#heroDot');
  const heroBase = orthogonalBases(140, 424242);
  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const heroState = {
    rho: 0.82,
    phase: 0,
    lastLabelRho: null
  };

  function drawHero(s, rho) {
    const ctx = s.ctx;
    const w = s.w;
    const h = s.h;
    ctx.clearRect(0, 0, w, h);

    const pad = 8;
    const plotW = Math.max(1, w - pad * 2);
    const plotH = Math.max(1, h - pad * 2);
    const domain = 7.6;
    const X = (x) => pad + ((x + domain) / (domain * 2)) * plotW;
    const Y = (y) => h - pad - ((y + domain) / (domain * 2)) * plotH;
    const ox = X(0);
    const oy = Y(0);
    const sigma = 2.35;
    const k = Math.sqrt(Math.max(0, 1 - rho * rho));

    ctx.save();
    clipPlot(ctx, pad, pad, plotW, plotH);

    ctx.fillStyle = 'rgba(94,223,195,.025)';
    ctx.fillRect(ox, pad, Math.max(0, w - pad - ox), Math.max(0, oy - pad));
    ctx.fillRect(pad, oy, Math.max(0, ox - pad), Math.max(0, h - pad - oy));
    ctx.fillStyle = 'rgba(255,159,125,.026)';
    ctx.fillRect(pad, pad, Math.max(0, ox - pad), Math.max(0, oy - pad));
    ctx.fillRect(ox, oy, Math.max(0, w - pad - ox), Math.max(0, h - pad - oy));

    ctx.strokeStyle = 'rgba(245,240,227,.055)';
    ctx.lineWidth = 1;
    for (let v = -6; v <= 6; v += 3) {
      if (v === 0) continue;
      const gx = Math.round(X(v)) + 0.5;
      const gy = Math.round(Y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, pad);
      ctx.lineTo(gx, h - pad);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pad, gy);
      ctx.lineTo(w - pad, gy);
      ctx.stroke();
    }

    // 1.5-sigma ellipse.
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * TAU;
      const ex = 1.5 * sigma * Math.cos(t);
      const ey = 1.5 * sigma * (rho * Math.cos(t) + k * Math.sin(t));
      const px = X(ex);
      const py = Y(ey);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(245,240,227,.16)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const p of heroBase) {
      const x = sigma * p.a;
      const y = sigma * (rho * p.a + k * p.b);
      if (Math.abs(x) > domain || Math.abs(y) > domain) continue;
      const product = x * y;
      ctx.beginPath();
      ctx.arc(X(x), Y(y), 1.95, 0, TAU);
      ctx.fillStyle =
        product >= 0 ? 'rgba(94,223,195,.82)' : 'rgba(255,159,125,.78)';
      ctx.fill();
    }

    // Mean axes.
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(245,240,227,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox, pad);
    ctx.lineTo(ox, h - pad);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pad, oy);
    ctx.lineTo(w - pad, oy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(ox, oy, 3.2, 0, TAU);
    ctx.fillStyle = 'rgba(21,35,31,.95)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,240,227,.6)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.font = '500 8.5px ' + FONT_MONO;
    ctx.fillStyle = 'rgba(245,240,227,.28)';
    ctx.textAlign = 'left';
    ctx.fillText('EX', ox + 6, oy - 6);
    ctx.fillText('EY', ox + 6, pad + 13);

    ctx.restore();

    if (
      heroState.lastLabelRho === null ||
      Math.abs(rho - heroState.lastLabelRho) > 0.004
    ) {
      heroState.lastLabelRho = rho;
      heroR.textContent = 'r = ' + sf2(rho);
      if (rho > 0.16) {
        heroStatus.textContent = '正相关：一起偏大、一起偏小';
        heroDot.className = '';
      } else if (rho < -0.16) {
        heroStatus.textContent = '负相关：一个偏大、一个偏小';
        heroDot.className = 'neg';
      } else {
        heroStatus.textContent = '几乎无关：点云接近圆形';
        heroDot.className = 'zero';
      }
    }
  }

  const heroStage = mountCanvas(heroCanvas, heroWrap, (s) => drawHero(s, heroState.rho));
  if (reduceMotion) {
    const note = $('.hv-note');
    if (note) note.textContent = '静态示意';
  }

  let heroVisible = true;
  let heroRaf = null;
  let heroLast = 0;

  function heroTick(now) {
    if (!heroVisible || document.hidden) {
      heroRaf = null;
      return;
    }
    if (!heroLast) heroLast = now;
    const dt = Math.min((now - heroLast) / 1000, 0.06);
    heroLast = now;
    heroState.phase += dt * 0.5;
    heroState.rho = 0.82 * Math.cos(heroState.phase);
    drawHero(heroStage, heroState.rho);
    heroRaf = requestAnimationFrame(heroTick);
  }

  function startHero() {
    if (reduceMotion || heroRaf !== null || !heroVisible || document.hidden) return;
    heroLast = 0;
    heroRaf = requestAnimationFrame(heroTick);
  }

  function stopHero() {
    if (heroRaf !== null) {
      cancelAnimationFrame(heroRaf);
      heroRaf = null;
    }
  }

  if ('IntersectionObserver' in window) {
    const heroObserver = new IntersectionObserver(
      (entries) => {
        heroVisible = entries[0].isIntersecting;
        if (heroVisible) startHero();
        else stopHero();
      },
      { threshold: 0 }
    );
    heroObserver.observe(heroWrap);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopHero();
    else startHero();
  });
  startHero();

  /* ------------------------------------------------------------
     quiz
  ------------------------------------------------------------ */
  const quizCards = $$('.quiz-card');
  const quizScore = $('#quizScore');
  const quizResult = $('#quizResult');
  let quizAnswered = 0;
  let quizCorrect = 0;

  function refreshQuiz() {
    quizScore.innerHTML = '<b>' + quizCorrect + '</b> / ' + quizCards.length;
    if (quizAnswered < quizCards.length) return;

    let title = '';
    let detail = '';
    if (quizCorrect === quizCards.length) {
      title = '全部正确。';
      detail = '你抓住了协方差的方向、量纲，以及“不相关 ≠ 独立”这几个关键点。';
    } else if (quizCorrect >= 2) {
      title = '大部分抓住了。';
      detail = '回看答错那题的说明，再拖一拖上面的点，会更牢。';
    } else {
      title = '别急，协方差本来就容易混。';
      detail = '记住四句话：同号为正、异号抵消、协方差有量纲、Cov=0 不等于独立。';
    }
    quizResult.innerHTML =
      '<span class="result-mark">' + quizCorrect + ' / ' + quizCards.length +
      '</span> <b>' + title + '</b> ' + detail;
    quizResult.classList.add('show');
  }

  quizCards.forEach((card) => {
    const answer = card.dataset.answer;
    const opts = $$('.opt', card);
    opts.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (card.dataset.done === '1') return;
        card.dataset.done = '1';
        card.classList.add('answered');

        const correctBtn = card.querySelector('.opt[data-opt="' + answer + '"]');
        if (correctBtn) correctBtn.classList.add('correct');
        if (btn.dataset.opt === answer) quizCorrect++;
        else btn.classList.add('wrong');

        opts.forEach((b) => {
          b.disabled = true;
        });
        const explain = card.querySelector('.explain');
        if (explain) explain.classList.add('show');
        quizAnswered++;
        refreshQuiz();
      });
    });
  });

  refreshQuiz();

  /* ------------------------------------------------------------
     reveal, nav, scroll progress
  ------------------------------------------------------------ */
  const revealEls = $$('.reveal');
  const heroReveals = $$('.hero .reveal');
  heroReveals.forEach((el) => el.classList.add('in'));

  if ('IntersectionObserver' in window && !reduceMotion) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -36px 0px' }
    );
    revealEls.forEach((el) => {
      if (!el.classList.contains('in')) revealObserver.observe(el);
    });
  } else {
    revealEls.forEach((el) => el.classList.add('in'));
  }

  const progress = $('#scrollProgress');
  function updateProgress() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const pct = max > 0 ? clamp(window.scrollY / max, 0, 1) * 100 : 0;
    progress.style.width = pct + '%';
  }
  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress);
  updateProgress();

  const navLinks = $$('.nav-links a');
  if ('IntersectionObserver' in window) {
    const byId = new Map();
    navLinks.forEach((a) => byId.set(a.getAttribute('href').slice(1), a));
    const navObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          navLinks.forEach((a) => a.classList.remove('active'));
          const link = byId.get(entry.target.id);
          if (link) link.classList.add('active');
        });
      },
      { rootMargin: '-35% 0px -55% 0px', threshold: 0 }
    );
    byId.forEach((_, id) => {
      const section = document.getElementById(id);
      if (section) navObserver.observe(section);
    });
  }

  /* Friendly error recovery for a canvas-free environment is unnecessary here,
     but guarding against silent breakage helps when the page is embedded. */
  window.addEventListener('error', (event) => {
    if (event && event.message) {
      // Keep the page usable; the visuals are the only non-essential part.
      console.warn('CovLab:', event.message);
    }
  });
})();