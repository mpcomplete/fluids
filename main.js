var has_float_linear = false;

const SIZE = 512;
var TEX_PROPS = {
  type: 'float16',
  format: 'rgba',
  wrap: 'clamp',
  width: SIZE,
  height: SIZE
};

var config = {
  clamp_edges: true,
};

const extend = (a, b) => Object.assign(b, a);

const regl = require('regl')({
  extensions: [ 'OES_texture_half_float' ],
  optionalExtensions: ['oes_texture_half_float_linear'],
  onDone: function (err, regl) {
    if (err) {
      console.log(err);
      return;
    }

    if (regl.hasExtension('oes_texture_half_float_linear')) {
      TEX_PROPS = extend(TEX_PROPS, {mag: 'linear', min: 'linear'});
      has_float_linear = true;
    } else {
      TEX_PROPS = extend(TEX_PROPS, {mag: 'nearest', min: 'nearest'});
      has_float_linear = false;
    }
  }
});

function createFBO() {
 return regl.framebuffer({
    color: regl.texture(TEX_PROPS),
    depthStencil: false
  });
}

function createDoubleFBO() {
  return {
    src: createFBO(),
    dst: createFBO(),
    swap: function() {
      [this.src, this.dst] = [this.dst, this.src];
    }
  }
}

var velocity = createDoubleFBO();
var ink = createDoubleFBO();
var pressure = createDoubleFBO();
var divVelocity = createFBO();

//// Mouse/Touchscreen

function Pointer() {
  this.id = -1;
  this.pos = [0, 0];
  this.delta = [0, 0];
  this.deltaY = 0;
  this.isDown = false;
}
var pointers = [new Pointer()];
var canvas = document.getElementsByTagName("canvas")[0];

function updatePointer(pointer, pos, isDown, isDelta) {
  var lastPos = pointer.pos;
  pointer.pos = [Math.floor(pos[0] * window.devicePixelRatio) / canvas.width,
                 1.0 - Math.floor(pos[1] * window.devicePixelRatio) / canvas.height];
  pointer.isDown = isDown;
  if (isDelta) {
    pointer.delta = [pointer.pos[0] - lastPos[0], pointer.pos[1] - lastPos[1]];
  } else {
    pointer.delta = [0.0, 0.0];
  }
  pointer.color = generateColor();
}

canvas.addEventListener('mousedown', e => {
  let p = pointers.find(p => p.id == -1); 
  updatePointer(p, [e.offsetX, e.offsetY], true, false);
});
canvas.addEventListener('mousemove', e => {
  let p = pointers.find(p => p.id == -1); 
  if (!p.isDown)
    return;
    updatePointer(p, [e.offsetX, e.offsetY], true, true);
});
window.addEventListener('mouseup', () => {
  let p = pointers.find(p => p.id == -1);
  p.isDown = false;
});

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const touches = e.targetTouches;
  while (touches.length >= pointers.length)
    pointers.push(new Pointer());
  for (let i = 0; i < touches.length; i++) {
    pointers[i+1].id = touches[i].identifier;
    updatePointer(pointers[i+1], [touches[i].pageX, touches[i].pageY], true, false);
  }
});
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  const touches = e.targetTouches;
  for (let i = 0; i < touches.length; i++) {
    let p = pointers[i+1];
    if (!p.isDown) continue;
    updatePointer(p, [touches[i].pageX, touches[i].pageY], true, true);
  }
}, false);
window.addEventListener('touchend', e => {
  const touches = e.changedTouches;
  for (let i = 0; i < touches.length; i++) {
    let p = pointers.find(p => p.id == touches[i].identifier);
    if (p == null) continue;
    p.isDown = false;
  }
});

const randInt = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo));
const randItem = (a) => a[randInt(0, a.length)]

let nextColor = null;
function generateColor () {
  if (nextColor == null) {
    const red = 0.;
    const yellow = .1;
    const green = .3;
    const blue = .6;
    const purple = .75;
    const pink = .9;
    nextColor = HSVtoRGB(Math.random(), 1.0, 1.0);
    // nextColor = HSVtoRGB(randItem([red, yellow, green, blue, purple, pink]), 1.0, 1.0);
    window.setTimeout(() => nextColor = null, 100);
  }
  return nextColor;
}

function HSVtoRGB(h, s, v) {
  let r, g, b, i, f, p, q, t;
  i = Math.floor(h * 6);
  f = h * 6 - i;
  p = v * (1 - s);
  q = v * (1 - f * s);
  t = v * (1 - (1 - f) * s);

  switch (i%6) {
    case 0: r=v, g=t, b=p; break;
    case 1: r=q, g=v, b=p; break;
    case 2: r=p, g=v, b=t; break;
    case 3: r=p, g=q, b=v; break;
    case 4: r=t, g=p, b=v; break;
    case 5: r=v, g=p, b=q; break;
  }

  return [
    r,
    g,
    b
  ];
}

//// Shaders

function myregl(p) {
  if (p.defines) {
    var defines = p.defines().map((d) => "#define " + d).join("\n");
    p.frag = defines + p.frag;
    delete p.defines;
  }
  return regl(extend({
    vert: `
    precision mediump float;
    uniform vec2 gridSize;
    attribute vec2 position;
    varying vec2 uv;
    varying vec2 uvL;
    varying vec2 uvR;
    varying vec2 uvT;
    varying vec2 uvB;
    void main () {
      vec2 dx = vec2(gridSize.x, 0.);
      vec2 dy = vec2(0., gridSize.y);
      uv = position * 0.5 + 0.5;
      uvL = uv - dx;
      uvR = uv + dx;
      uvB = uv - dy;
      uvT = uv + dy;
      gl_Position = vec4(position, 0., 1.);
    }`,
    
    attributes: {
      position: [
        -1, -1,
        -1, 1,
        1, 1,
        -1, -1,
        1, 1,
        1, -1
      ]
    },
    uniforms: extend(p.uniforms, {
      gridSize: [1./SIZE, 1./SIZE],
    }),
    count: 6,
    framebuffer: regl.prop("framebuffer")
  }, p));
}

const advect = myregl({
  frag: `
  precision mediump float;
  uniform sampler2D velocity;
  uniform sampler2D quantity;
  uniform float dt;
  uniform float dissipation;
  uniform vec2 gridSize;
  varying vec2 uv;

  vec4 bilerp(sampler2D sam, vec2 uv) {
#ifdef MANUAL_FILTERING
    vec2 st = uv / gridSize - 0.5;
    vec2 iuv = floor(st);
    vec2 fuv = fract(st);
    vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * gridSize);
    vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * gridSize);
    vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * gridSize);
    vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * gridSize);
    return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
#else
    return texture2D(sam, uv);
#endif
  }

  void main() {
    vec2 uvOld = uv - dt * bilerp(velocity, uv).xy;
    vec4 result = bilerp(quantity, uvOld);
    float decay = 1.0 + dissipation * dt;
    gl_FragColor = result / decay;
  }`,

  uniforms: {
    velocity: regl.prop('velocity'),
    quantity: regl.prop('quantity'),
    dt: 1./60,
    dissipation: .2,
    gridSize: [1. / SIZE, 1. / SIZE],
  },

  defines: () => !has_float_linear ? ['MANUAL_FILTERING'] : [],
});

const applyForce = myregl({
  frag: `
  precision mediump float;
  uniform sampler2D quantity;
  uniform vec2 mouse;
  uniform vec3 color;
  uniform float dt;
  varying vec2 uv;

  void main() {
    vec2 p = uv - mouse.xy;
    float d = exp(-dot(p, p) / .001);
    vec3 u = color*d + texture2D(quantity, uv).rgb;
    gl_FragColor = vec4(u, 1.);
  }`,

  uniforms: {
    quantity: regl.prop('quantity'),
    color: regl.prop('color'),
    mouse: regl.prop('mouse'),
    dt: 1./60,
  },
});

// One iteration of Jacobi technique:
//   xNext = (xLeft + xRight + xBottom + xTop + alpha*b[i,j]) / (beta)
// where alpha,beta are constants tailored to the application, b is a
// quantity field (either pressure or velocity), and x is what we're
// solving for.
const jacobi = myregl({
  frag: `
  precision mediump float;
  uniform sampler2D x;
  uniform sampler2D b;
  uniform float alpha;
  uniform float rBeta;
  varying vec2 uv;
  varying vec2 uvL;
  varying vec2 uvR;
  varying vec2 uvT;
  varying vec2 uvB;

  void main() {
    vec4 xL = texture2D(x, uvL);
    vec4 xR = texture2D(x, uvR);
    vec4 xB = texture2D(x, uvB);
    vec4 xT = texture2D(x, uvT);

    // b sample, from center
    vec4 bC = texture2D(b, uv);

#ifdef CLAMP_EDGES
    // Handle boundary edge (good only for pressure).
    vec4 xC = texture2D(x, uv);
    if (uvL.x < 0.) { xL = xC; }
    if (uvR.x > 1.) { xR = xC; }
    if (uvB.y < 0.) { xB = xC; }
    if (uvT.y > 1.) { xT = xC; }
#endif

    // evaluate Jacobi iteration
    gl_FragColor = (xL + xR + xB + xT + alpha * bC) * rBeta;
  }`,

  uniforms: {
    x: regl.prop('x'),
    b: regl.prop('b'),
    alpha: regl.prop('alpha'),
    rBeta: regl.prop('rBeta'),
  },
  defines: () => config.clamp_edges ? ['CLAMP_EDGES'] : [],
});

// result = div*quantity;
const divergence = myregl({
  frag: `
  precision mediump float;
  uniform sampler2D quantity;
  varying vec2 uv;
  varying vec2 uvL;
  varying vec2 uvR;
  varying vec2 uvT;
  varying vec2 uvB;

  void main() {
    float L = texture2D(quantity, uvL).x;
    float R = texture2D(quantity, uvR).x;
    float B = texture2D(quantity, uvB).y;
    float T = texture2D(quantity, uvT).y;

#ifdef CLAMP_EDGES
    // Handle boundary edge (good only for velocity).
    vec2 C = texture2D(quantity, uv).xy;
    if (uvL.x < 0.) { L = -C.x; }
    if (uvR.x > 1.) { R = -C.x; }
    if (uvB.y < 0.) { B = -C.y; }
    if (uvT.y > 1.) { T = -C.y; }
#endif

    float div = (R - L + T - B) * .5;
    gl_FragColor = vec4(div);
  }`,

  uniforms: {
    quantity: regl.prop('quantity'),
  },
  defines: () => config.clamp_edges ? ['CLAMP_EDGES'] : [],
});

// w = Velocity - grad Pressure;
const subtractPressure = myregl({
  frag: `
  precision mediump float;
  uniform sampler2D pressure;
  uniform sampler2D velocity;
  varying vec2 uv;
  varying vec2 uvL;
  varying vec2 uvR;
  varying vec2 uvT;
  varying vec2 uvB;

  void main() {
    float pL = texture2D(pressure, uvL).x;
    float pR = texture2D(pressure, uvR).x;
    float pB = texture2D(pressure, uvB).x;
    float pT = texture2D(pressure, uvT).x;
    vec2 uNew = texture2D(velocity, uv).xy;
    uNew -= vec2(pR - pL, pT - pB) * .5;
    gl_FragColor = vec4(uNew, 0., 1.);
  }`,

  uniforms: {
    pressure: regl.prop('pressure'),
    velocity: regl.prop('velocity'),
  },
});

// quantity = value*quantity;
const clearQuantity = myregl({
  frag: `
  precision mediump float;
  varying vec2 uv;
  uniform sampler2D quantity;
  uniform float value;
  void main () {
    gl_FragColor = value * texture2D(quantity, uv);
  }`,

  uniforms: {
    quantity: regl.prop('quantity'),
    value: regl.prop('value'),
  },
})

const draw = myregl({
  frag: `
  precision mediump float;
  uniform sampler2D quantity;
  uniform float time;
  varying vec2 uv;

  // 2D rotation matrix.
  mat2 rotate(float angle)
  {
    return mat2(
      vec2( cos(angle), sin(angle)),
      vec2(-sin(angle), cos(angle)));
  }

  void main() {
    vec2 st = uv;
    // st -= .5;
    // st = rotate(time*.2 - st.x)*st;
    // st = abs(sin(st*8.));
    gl_FragColor = vec4(texture2D(quantity, st).rgb, 1.);
  }`,

  uniforms: {
    quantity: regl.prop('quantity'),
    time: regl.context('time'),
  },
})

function doJacobi(count, x, p) {
  for (var i = 0; i < count; i++) {
    jacobi(extend(p, {x: x.src, rBeta: 1. / p.beta, framebuffer: x.dst}));
    x.swap();
  }
}

// Compute pressure field into pressure FBO, using divergence of velocity field.
function computePressure() {
  divergence({quantity: velocity.dst, framebuffer: divVelocity});
  doJacobi(20, pressure, {b: divVelocity, alpha: -1, beta: 4});
}

regl.frame(function () {
  const velocityScale = 50;
  regl.clear({
    color: [0, 0, 0, 1]
  })
  // pressure = .8*pressure -- keep most of our guess from last frame.
  clearQuantity({quantity: pressure.src, value: .8, framebuffer: pressure.dst});
  pressure.swap();

  advect({velocity: velocity.src, quantity: velocity.src, framebuffer: velocity.dst});
  advect({velocity: velocity.src, quantity: ink.src, framebuffer: ink.dst});

  for (let i = 0; i < pointers.length; i++) {
    if (pointers[i].isDown) {
      velocity.swap();
      ink.swap();
      applyForce({color: [velocityScale*pointers[i].delta[0], velocityScale*pointers[i].delta[1], 0.], mouse: pointers[i].pos, quantity: velocity.src, framebuffer: velocity.dst});
      applyForce({color: pointers[i].color, mouse: pointers[i].pos, quantity: ink.src, framebuffer: ink.dst});
    }
  }

  computePressure();
  velocity.swap();
  subtractPressure({velocity: velocity.src, pressure: pressure.dst, framebuffer: velocity.dst});

  draw({quantity: ink.dst});
  // draw({quantity: velocity.dst});
  velocity.swap();
  ink.swap();
})
