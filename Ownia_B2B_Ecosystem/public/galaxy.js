// Fondo "Galaxy" de la portada: campo de estrellas en WebGL2, versión sin React del componente
// Galaxy (React Bits). Uso: GalaxyBackground.mount(contenedor, opciones) → función para
// desmontar. Si el navegador no tiene WebGL2 no hace nada (queda el fondo CSS de la página).
(function () {
  'use strict';

  var MAX_LAYERS = 8;
  var MAX_COLORS = 4;
  var INTRO_SECONDS = 2.2;

  var VERTEX = '#version 300 es\n' +
    'in vec2 aPosition;\n' +
    'void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }';

  var FRAGMENT = [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'uniform float uTime;',
    'uniform vec2 uResolution;',
    'uniform vec2 uFocal;',
    'uniform vec2 uRotation;',
    'uniform float uGloss;',
    'uniform float uDepth;',
    'uniform float uDensity;',
    'uniform float uHueShift;',
    'uniform float uSpeed;',
    'uniform vec2 uMouse;',
    'uniform float uStarGlow;',
    'uniform float uFlareGain;',
    'uniform float uSquash;',
    'uniform float uSaturation;',
    'uniform float uMouseRepulsion;',
    'uniform float uTwinkleIntensity;',
    'uniform float uRotationAngle;',
    'uniform float uRepulsionStrength;',
    'uniform float uMouseActiveFactor;',
    'uniform float uAutoCenterRepulsion;',
    'uniform int uLayers;',
    'uniform vec3 uColors[' + MAX_COLORS + '];',
    'uniform int uColorCount;',
    'uniform float uWarp;',
    'uniform float uReveal;',
    'uniform float uMode;',
    'uniform vec3 uBackground;',
    'uniform float uOpacity;',
    'out vec4 outColor;',
    '#define STAR_COLOR_CUTOFF 0.2',
    '#define MAT45 mat2(0.7071, -0.7071, 0.7071, 0.7071)',
    '#define PERIOD 3.0',
    'float Hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float tri(float x) { return abs(fract(x) * 2.0 - 1.0); }',
    'float tris(float x) { float t = fract(x); return 1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0)); }',
    'float trisn(float x) { float t = fract(x); return 2.0 * (1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0))) - 1.0; }',
    'vec3 hsv2rgb(vec3 c) {',
    '  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);',
    '  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);',
    '  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);',
    '}',
    'float Star(vec2 uv, float flare, vec2 radial, float invReach) {',
    '#ifdef WARP',
    '  float along = dot(uv, radial);',
    '  float d = sqrt(max(dot(uv, uv) - uSquash * along * along, 0.0));',
    '#else',
    '  float d = length(uv);',
    '#endif',
    '  float m = uStarGlow / d;',
    '  float rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));',
    '  m += rays * flare * uFlareGain;',
    '  uv *= MAT45;',
    '  rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));',
    '  m += rays * 0.3 * flare * uFlareGain;',
    '  m *= smoothstep(1.0, 0.2, d * invReach);',
    '#ifdef WARP',
    '  m *= mix(1.0, smoothstep(1.0, 0.55, length(uv) * invReach), min(uWarp * 4.0, 1.0));',
    '#endif',
    '  return m;',
    '}',
    'vec3 StarLayer(vec2 uv, vec2 radial, vec2 repelAt, float pushCells, float spread) {',
    '  vec3 col = vec3(0.0);',
    '  vec2 gv = fract(uv) - 0.5;',
    '  vec2 id = floor(uv);',
    '  for (int y = -1; y <= 1; y++) {',
    '    for (int x = -1; x <= 1; x++) {',
    '      vec2 offset = vec2(float(x), float(y));',
    '      vec2 si = id + offset;',
    '      float seed = Hash21(si);',
    '      float size = fract(seed * 345.32);',
    '      float glossLocal = tri(uGloss / (PERIOD * seed + 1.0));',
    '      float flareSize = smoothstep(0.9, 1.0, size) * glossLocal;',
    '#ifdef PALETTE',
    '      float pick = Hash21(si + 7.0) * float(uColorCount);',
    '      vec3 base = uColors[int(min(floor(pick), float(uColorCount - 1)))];',
    '#else',
    '      float red = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 1.0)) + STAR_COLOR_CUTOFF;',
    '      float blu = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 3.0)) + STAR_COLOR_CUTOFF;',
    '      float grn = min(red, blu) * seed;',
    '      vec3 base = vec3(red, grn, blu);',
    '      float hue = atan(base.g - base.r, base.b - base.r) / (2.0 * 3.14159) + 0.5;',
    '      hue = fract(hue + uHueShift / 360.0);',
    '      float sat = length(base - vec3(dot(base, vec3(0.299, 0.587, 0.114)))) * uSaturation;',
    '      float val = max(max(base.r, base.g), base.b);',
    '      base = hsv2rgb(vec3(hue, sat, val));',
    '#endif',
    '      vec2 pad = vec2(tris(seed * 34.0 + uTime * uSpeed / 10.0), tris(seed * 38.0 + uTime * uSpeed / 30.0)) - 0.5;',
    '      vec2 shift = vec2(0.0);',
    '      float invReach = 1.0;',
    '#ifdef REPEL',
    '      vec2 away = si + 0.5 + pad - repelAt;',
    '      float dist = length(away);',
    '      float q = dist * spread;',
    '      float cells = pushCells * exp(-q * q);',
    '      float moved = cells * inversesqrt(1.0 + cells * cells * 2.78);',
    '      shift = away * (moved / max(dist, 0.0001));',
    '      invReach = 1.0 / (1.0 - moved);',
    '#endif',
    '      float star = Star(gv - offset - pad - shift, flareSize, radial, invReach);',
    '      float twinkle = trisn(uTime * uSpeed + seed * 6.2831) * 0.5 + 1.0;',
    '      twinkle = mix(1.0, twinkle, uTwinkleIntensity);',
    '      col += star * twinkle * size * base;',
    '    }',
    '  }',
    '  return col;',
    '}',
    'void main() {',
    '  vec2 focalPx = uFocal * uResolution;',
    '  vec2 uv = (gl_FragCoord.xy - focalPx) / uResolution.y;',
    '  vec2 mouseNorm = uMouse - vec2(0.5);',
    '  vec2 repelAt = vec2(0.0);',
    '  float strength = 0.0;',
    '  float push = 0.0;',
    '  if (uAutoCenterRepulsion > 0.0) {',
    '    strength = uAutoCenterRepulsion;',
    '    push = strength * 0.05;',
    '  } else if (uMouseRepulsion > 0.5) {',
    '    repelAt = (uMouse * uResolution - focalPx) / uResolution.y;',
    '    strength = max(uRepulsionStrength, 0.0);',
    '    push = strength * 0.05 * uMouseActiveFactor;',
    '  } else {',
    '    uv += mouseNorm * 0.1 * uMouseActiveFactor;',
    '  }',
    '  float radius = 0.16 + 0.04 * strength;',
    '  vec2 radial = length(uv) > 0.0001 ? normalize(uv) : vec2(1.0, 0.0);',
    '  float angle = uRotationAngle;',
    '  uv = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * uv;',
    '  uv = mat2(uRotation.x, -uRotation.y, uRotation.y, uRotation.x) * uv;',
    '  radial = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * radial;',
    '  radial = mat2(uRotation.x, -uRotation.y, uRotation.y, uRotation.x) * radial;',
    '  repelAt = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * repelAt;',
    '  repelAt = mat2(uRotation.x, -uRotation.y, uRotation.y, uRotation.x) * repelAt;',
    '  vec3 col = vec3(0.0);',
    '  float layers = float(uLayers);',
    '  for (int k = 0; k < ' + MAX_LAYERS + '; k++) {',
    '    if (k >= uLayers) break;',
    '    float i = float(k) / layers;',
    '    float depth = fract(i + uDepth);',
    '    float scale = mix(20.0 * uDensity, 0.5 * uDensity, depth);',
    '    float fade = depth * smoothstep(1.0, 0.9, depth);',
    '    vec2 offset = vec2(i * 453.32);',
    '    col += StarLayer(uv * scale + offset, radial, repelAt * scale + offset, push * scale, 1.0 / (scale * radius)) * fade;',
    '  }',
    '  col *= uReveal;',
    '  if (uMode > 1.5) {',
    '    vec3 lit = col * smoothstep(0.0, 0.3, length(col));',
    '    float energy = max(max(lit.r, lit.g), lit.b);',
    '    vec3 tint = lit / max(energy, 0.0001);',
    '    vec3 ink = tint * (0.16 / max(dot(tint, vec3(0.2126, 0.7152, 0.0722)), 0.16));',
    '    float coverage = pow(min(energy * 1.3, 1.0), 1.3) * 0.92 * uOpacity;',
    '    outColor = uMode > 2.5 ? vec4(ink * coverage, coverage) : vec4(mix(uBackground, ink, coverage), 1.0);',
    '  } else if (uMode > 0.5) {',
    '    float alpha = min(smoothstep(0.0, 0.3, length(col)), 1.0) * uOpacity;',
    '    outColor = vec4(col * alpha, alpha);',
    '  } else {',
    '    outColor = vec4(mix(uBackground, col, uOpacity), 1.0);',
    '  }',
    '}',
  ].join('\n');

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function compile(gl, palette, repel, warp) {
    var defines = (palette ? '#define PALETTE\n' : '') + (repel ? '#define REPEL\n' : '') + (warp ? '#define WARP\n' : '');
    var program = gl.createProgram();
    var vertex = gl.createShader(gl.VERTEX_SHADER);
    var fragment = gl.createShader(gl.FRAGMENT_SHADER);
    if (!program || !vertex || !fragment) return null;
    gl.shaderSource(vertex, VERTEX);
    gl.shaderSource(fragment, FRAGMENT.replace('\n', '\n' + defines));
    gl.compileShader(vertex);
    gl.compileShader(fragment);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return program;
  }

  function link(gl, program) {
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    var uniforms = {};
    var count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < count; i++) {
      var info = gl.getActiveUniform(program, i);
      if (info) uniforms[info.name.replace('[0]', '')] = gl.getUniformLocation(program, info.name);
    }
    return { program: program, uniforms: uniforms };
  }

  var DEFAULTS = {
    focal: [0.5, 0.5], rotation: [1, 0], starSpeed: 0.5, density: 1, hueShift: 140, disableAnimation: false,
    speed: 1, mouseInteraction: true, glowIntensity: 0.3, saturation: 0, mouseRepulsion: true, repulsionStrength: 2,
    twinkleIntensity: 0.3, rotationSpeed: 0.1, autoCenterRepulsion: 0, transparent: true, lightMode: false,
    starColors: null, starSize: 1, flareIntensity: 1, layers: 4, direction: 'forward', clickWarp: true, intro: true,
    backgroundColor: null, opacity: 1, dpr: null,
  };

  function mount(container, options) {
    var o = {};
    for (var k in DEFAULTS) o[k] = options && options[k] !== undefined ? options[k] : DEFAULTS[k];
    var s = {
      focal: o.focal, rotation: o.rotation, starSpeed: o.starSpeed, density: Math.max(0.01, o.density),
      hueShift: o.hueShift, disableAnimation: o.disableAnimation, speed: o.speed, mouseInteraction: o.mouseInteraction,
      glowIntensity: Math.max(0, o.glowIntensity), saturation: Math.max(0, o.saturation), mouseRepulsion: o.mouseRepulsion,
      repulsionStrength: o.repulsionStrength, twinkleIntensity: clamp(o.twinkleIntensity, 0, 1),
      rotationSpeed: o.rotationSpeed, autoCenterRepulsion: Math.max(0, o.autoCenterRepulsion), transparent: o.transparent,
      lightMode: o.lightMode, palette: Array.isArray(o.starColors) ? o.starColors.filter(Boolean).slice(0, MAX_COLORS) : [],
      starSize: Math.max(0, o.starSize), flareIntensity: Math.max(0, o.flareIntensity),
      layers: clamp(Math.round(o.layers), 2, MAX_LAYERS), reverse: o.direction === 'backward', clickWarp: o.clickWarp,
      intro: o.intro, backgroundColor: o.backgroundColor, opacity: clamp(o.opacity, 0, 1), dpr: o.dpr,
    };

    var canvas = document.createElement('canvas');
    canvas.className = 'galaxy-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);
    var gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) { canvas.remove(); return function () {}; }

    var parallel = gl.getExtension('KHR_parallel_shader_compile');
    var programs = new Map();
    var keyOf = function (p, r, w) { return (p ? 4 : 0) + (r ? 2 : 0) + (w ? 1 : 0); };
    var entry = function (p, r, w) {
      var key = keyOf(p, r, w);
      var found = programs.get(key);
      if (!found) {
        found = { program: compile(gl, p, r, w), linked: null, done: false };
        programs.set(key, found);
      }
      return found;
    };
    var variant = function (p, r, w, wait) {
      var found = entry(p, r, w);
      if (!found.done && found.program) {
        if (!wait && parallel && !gl.getProgramParameter(found.program, parallel.COMPLETION_STATUS_KHR)) return null;
        found.linked = link(gl, found.program);
        found.done = true;
      }
      return found.linked;
    };
    if (!variant(s.palette.length > 0, false, false, true)) {
      programs.forEach(function (f) { if (f.program) gl.deleteProgram(f.program); });
      canvas.remove();
      return function () {};
    }

    var buffer = gl.createBuffer();
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    var probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    var cache = new Map();
    var parse = function (value, fallback) {
      if (!value) return fallback;
      var key = String(value);
      if (cache.has(key)) return cache.get(key);
      var rgb = fallback;
      if (probe) {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = '#000000';
        probe.fillStyle = key;
        probe.fillRect(0, 0, 1, 1);
        var d = probe.getImageData(0, 0, 1, 1).data;
        rgb = [d[0] / 255, d[1] / 255, d[2] / 255];
      }
      cache.set(key, rgb);
      return rgb;
    };
    var colors = new Float32Array(MAX_COLORS * 3);
    var pointer = { x: 0.5, y: 0.5, inside: false };
    var state = { time: 0, gloss: 0, depth: 0, angle: 0, mx: 0.5, my: 0.5, active: 0, boost: 0, reveal: s.intro && !reduce ? 0 : 1 };
    var raf = 0;
    var last = 0;
    var visible = true;

    function render() {
      s.palette.forEach(function (value, index) { colors.set(parse(value, [1, 1, 1]), index * 3); });
      var mode = s.lightMode ? (s.transparent ? 3 : 2) : s.transparent ? 1 : 0;
      var background = parse(s.backgroundColor, s.lightMode ? [1, 1, 1] : [0, 0, 0]);
      var palette = s.palette.length > 0;
      var repel = s.autoCenterRepulsion > 0 || (s.mouseRepulsion && s.repulsionStrength > 0 && state.active > 0);
      var warp = state.boost > 0;
      var base = variant(palette, false, false, true);
      if (!base) return;
      var program = ((repel || warp) ? variant(palette, repel, warp, false) : null) || base;
      var u = program.uniforms;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program.program);
      gl.bindVertexArray(vao);
      gl.uniform1f(u.uTime, state.time);
      gl.uniform2f(u.uResolution, canvas.width, canvas.height);
      gl.uniform2f(u.uFocal, s.focal[0], s.focal[1]);
      gl.uniform2f(u.uRotation, s.rotation[0], s.rotation[1]);
      gl.uniform1f(u.uGloss, state.gloss);
      gl.uniform1f(u.uDepth, state.depth);
      gl.uniform1f(u.uDensity, s.density);
      gl.uniform1f(u.uHueShift, s.hueShift);
      gl.uniform1f(u.uSpeed, s.speed);
      gl.uniform2f(u.uMouse, state.mx, state.my);
      var stretch = 1 + state.boost * 5;
      gl.uniform1f(u.uStarGlow, (0.05 * s.glowIntensity * s.starSize) / Math.pow(stretch, 0.6));
      gl.uniform1f(u.uFlareGain, s.glowIntensity * s.flareIntensity);
      gl.uniform1f(u.uSquash, 1 - 1 / (stretch * stretch));
      gl.uniform1f(u.uSaturation, s.saturation);
      gl.uniform1f(u.uMouseRepulsion, s.mouseRepulsion ? 1 : 0);
      gl.uniform1f(u.uTwinkleIntensity, s.twinkleIntensity);
      gl.uniform1f(u.uRotationAngle, state.angle);
      gl.uniform1f(u.uRepulsionStrength, s.repulsionStrength);
      gl.uniform1f(u.uMouseActiveFactor, state.active);
      gl.uniform1f(u.uAutoCenterRepulsion, s.autoCenterRepulsion);
      gl.uniform1i(u.uLayers, s.layers);
      gl.uniform3fv(u.uColors, colors);
      gl.uniform1i(u.uColorCount, s.palette.length);
      gl.uniform1f(u.uWarp, state.boost);
      var fade = Math.min(1, state.reveal / 0.35);
      gl.uniform1f(u.uReveal, fade * fade * (3 - 2 * fade));
      gl.uniform1f(u.uMode, mode);
      gl.uniform3fv(u.uBackground, background);
      gl.uniform1f(u.uOpacity, s.opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(now) {
      raf = 0;
      if (!visible || document.hidden) return;
      var dt = last ? clamp((now - last) / 1000, 0.0005, 0.05) : 1 / 60;
      last = now;
      var motion = s.disableAnimation || reduce ? 0 : 1;
      if (s.intro && !reduce && state.reveal < 1) {
        state.reveal = Math.min(1, state.reveal + dt / INTRO_SECONDS);
        state.boost = Math.max(state.boost, Math.pow(1 - state.reveal, 2) * 1.4);
      } else if (!s.intro || reduce) {
        state.reveal = 1;
      }
      var flight = (s.starSpeed / 10) * (s.reverse ? -1 : 1);
      state.time += dt * motion;
      state.gloss += dt * flight * motion;
      state.depth += dt * flight * s.speed * motion * (1 + state.boost * 14);
      state.angle += dt * s.rotationSpeed * motion;
      state.boost *= Math.exp(-dt * 1.3);
      if (state.boost < 0.001) state.boost = 0;
      var follow = 1 - Math.exp(-dt / 0.325);
      var engaged = s.mouseInteraction && pointer.inside && !reduce;
      if (engaged) {
        state.mx += (pointer.x - state.mx) * follow;
        state.my += (pointer.y - state.my) * follow;
      }
      var target = engaged ? 1 : 0;
      state.active += (target - state.active) * follow;
      if (Math.abs(target - state.active) < 0.001) state.active = target;
      render();
      var busy = motion > 0 || state.boost > 0 || state.active !== target || state.reveal < 1;
      if (busy) raf = requestAnimationFrame(frame);
      else last = 0;
    }

    function wake() {
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
    }

    function resize() {
      var width = Math.max(1, container.clientWidth);
      var height = Math.max(1, container.clientHeight);
      var ratio = Math.min(s.dpr || window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      render();
      wake();
    }

    function locate(event) {
      var rect = container.getBoundingClientRect();
      var x = event.clientX - rect.left;
      var y = event.clientY - rect.top;
      pointer.inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      pointer.x = x / Math.max(1, rect.width);
      pointer.y = 1 - y / Math.max(1, rect.height);
    }

    function onPointerMove(event) { locate(event); wake(); }
    function onPointerDown(event) {
      locate(event);
      // Un click en un nodo del mapa navega: el "warp" solo con click en el fondo.
      if (!pointer.inside || !s.clickWarp || reduce || (event.target && event.target.closest && event.target.closest('a,button'))) return;
      state.boost = Math.min(1.6, state.boost + 1);
      wake();
    }
    function onPointerUp(event) { if (event.pointerType !== 'mouse') pointer.inside = false; }
    function onPointerLeave() { pointer.inside = false; }
    function onVisibility() { last = 0; wake(); }

    var resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    var intersection = new IntersectionObserver(function (entries) {
      visible = entries.some(function (e) { return e.isIntersecting; });
      if (visible) { last = 0; wake(); }
    });
    intersection.observe(container);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibility);
    resize();

    var repelling = s.autoCenterRepulsion > 0 || (s.mouseInteraction && s.mouseRepulsion);
    var tinted = s.palette.length > 0;
    if (s.clickWarp || s.intro) entry(tinted, false, true);
    if (repelling) entry(tinted, true, false);
    if (repelling && s.clickWarp) entry(tinted, true, true);

    return function unmount() {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      programs.forEach(function (f) { if (f.program) gl.deleteProgram(f.program); });
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      canvas.remove();
    };
  }

  window.GalaxyBackground = { mount: mount };
})();
