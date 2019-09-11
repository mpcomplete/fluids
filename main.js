const regl = require('regl')({
  extensions: [ 'OES_texture_float', 'OES_texture_float_linear' ]
});
const extend = (a, b) => Object.assign(b, a)

const SIZE = 512;
const TEX_PROPS = {
  type: 'float', 
  format: 'rgba',
  mag: 'linear',
  min: 'linear',
  wrap: 'repeat',
  width: SIZE, 
  height: SIZE
}

function createFBO(data) {
 return regl.framebuffer({
    color: regl.texture(extend(TEX_PROPS, {data})),
    depthStencil: false
  });
}

function createDoubleFBO(data) {
  return {
    src: createFBO(data),
    dst: createFBO(data),
    swap: function() {
      [this.src, this.dst] = [this.dst, this.src];
    }
  }
}

var velocity = createDoubleFBO((Array(SIZE * SIZE * 4)).fill(0));
var ink = createDoubleFBO((Array(SIZE * SIZE * 4)).fill(0).map(
    (v, i) => i / (SIZE*SIZE*4)));
var pressure = createDoubleFBO((Array(SIZE * SIZE * 4)).fill(0));
var divVelocity = createFBO((Array(SIZE * SIZE * 4)).fill(0));

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

function generateColor () {
  let c = HSVtoRGB(Math.random(), 1.0, 1.0);
  return c;
}

function HSVtoRGB(h, s, v) {
  let r, g, b, i, f, p, q, t;
  i = Math.floor(h * 6);
  f = h * 6 - i;
  p = v * (1 - s);
  q = v * (1 - f * s);
  t = v * (1 - (1 - f) * s);

  switch (i % 6) {
      case 0: r = v, g = t, b = p; break;
      case 1: r = q, g = v, b = p; break;
      case 2: r = p, g = v, b = t; break;
      case 3: r = p, g = q, b = v; break;
      case 4: r = t, g = p, b = v; break;
      case 5: r = v, g = p, b = q; break;
  }

  return [
      r,
      g,
      b
  ];
}

//// Shaders

function myregl(p) {
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
  varying vec2 uv;

  void main() {
    vec2 u = texture2D(velocity, uv).xy;
    vec2 uvOld = uv - u*dt;
    float decay = 1.0 + dissipation * dt;
    gl_FragColor = vec4(texture2D(quantity, uvOld).xyz / decay, 1.);
  }`,

  uniforms: {
    velocity: regl.prop('velocity'),
    quantity: regl.prop('quantity'),
    dt: 1./60,
    dissipation: .2,
  },
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

    // evaluate Jacobi iteration
    gl_FragColor = (xL + xR + xB + xT + alpha * bC) * rBeta;
  }`,

  uniforms: {
    x: regl.prop('x'),
    b: regl.prop('b'),
    alpha: regl.prop('alpha'),
    rBeta: regl.prop('rBeta'),
  },
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
    float div = (R - L + T - B) * .5;
    gl_FragColor = vec4(div);
  }`,

  uniforms: {
    quantity: regl.prop('quantity'),
  },
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
  varying vec2 uv;

  void main() {
    gl_FragColor = vec4(texture2D(quantity, uv).rgb, 1.);
  }`,

  uniforms: {
    quantity: regl.prop('quantity'),
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
  doJacobi(50, pressure, {b: divVelocity, alpha: -1, beta: 4});
}

regl.frame(function () {
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
      applyForce({color: [30*pointers[i].delta[0], 30*pointers[i].delta[1], 0.], mouse: pointers[i].pos, quantity: velocity.src, framebuffer: velocity.dst});
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
