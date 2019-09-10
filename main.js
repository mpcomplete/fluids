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

function myregl(p) {
  return regl(extend(p, {
    vert: `
    precision mediump float;
    attribute vec2 position;
    varying vec2 uv;
    void main () {
      uv = position * 0.5 + 0.5;
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

    count: 6,
  }));
}

var velocity = createDoubleFBO((Array(SIZE * SIZE * 4)).fill(0));
var ink = createDoubleFBO((Array(SIZE * SIZE * 4)).fill(0).map(
    () => Math.random() > 0.99 ? 20 : 0));
var pressure = createDoubleFBO((Array(SIZE * SIZE * 4)).fill(0));
var divVelocity = createFBO((Array(SIZE * SIZE * 4)).fill(0));

var mouse = {pos: [0.0, 0.0], delta: [0.0, 0.0], isDown: false};
var reglCanvas = document.getElementsByTagName("canvas")[0]; // TODO: rename

reglCanvas.addEventListener('mousedown', e => {
  updateMouse(e);
});
reglCanvas.addEventListener('mousemove', e => {
  if (!mouse.isDown)
    return;
  updateMouse(e, true);
});
window.addEventListener('mouseup', () => {
  mouse = {pos: [0.0, 0.0], delta: [0.0, 0.0], isDown: false};
});
function updateMouse(e, delta) {
  var lastPos = mouse.pos;
  mouse.pos = [Math.floor(e.offsetX * window.devicePixelRatio) / reglCanvas.width,
               1.0 - Math.floor(e.offsetY * window.devicePixelRatio) / reglCanvas.height];
  mouse.isDown = true;
  if (delta) {
    mouse.delta = [mouse.pos[0] - lastPos[0], mouse.pos[1] - lastPos[1]];
  } else {
    mouse.delta = [0.0, 0.0];
  }
  mouse.color = generateColor();

  console.log("mouse: ", mouse.pos, mouse.delta);
}

function generateColor () {
  let c = HSVtoRGB(Math.random(), 1.0, 1.0);
  c[0] *= 0.15;
  c[1] *= 0.15;
  c[2] *= 0.15;
  return c;
}

function HSVtoRGB (h, s, v) {
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

const advect = myregl({
  frag: `
  precision mediump float;
  uniform sampler2D velocity;
  uniform sampler2D quantity;
  uniform float dt;
  varying vec2 uv;

  void main() {
    vec2 u = texture2D(velocity, uv).xy;
    vec2 uvOld = uv - u*dt;
    gl_FragColor = vec4(texture2D(quantity, uvOld).xyz, 1.);
  }`,

  uniforms: {
    velocity: regl.prop('velocity'),
    quantity: regl.prop('quantity'),
    dt: 1./60,
  },

  framebuffer: regl.prop('framebuffer'),
});

const applyForce = myregl({
  frag: `
  precision mediump float;
  uniform vec2 mouse;
  uniform vec3 color;
  uniform float gridSize;
  uniform float dt;
  varying vec2 uv;

  void main() {
    vec2 p = uv - mouse.xy;
    float d = exp(-dot(p, p) / .001);
    vec3 u = color*d;
    gl_FragColor = vec4(u, 1.);
  }`,

  uniforms: {
    color: regl.prop('color'),
    mouse: () => mouse.pos,
    dt: 1./60,
    gridSize: 1./SIZE,
  },

  blend: {
    enable: true,
    func: {src: 'one', dst: 'one'},
  },

  framebuffer: regl.prop('framebuffer'),
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
  uniform vec2 gridSize;
  uniform float alpha;
  uniform float rBeta;
  varying vec2 uv;

  void main() {
    vec3 d = vec3(gridSize.xy, 0.);
    vec4 xL = texture2D(x, uv - d.xz);
    vec4 xR = texture2D(x, uv + d.xz);
    vec4 xB = texture2D(x, uv - d.zy);
    vec4 xT = texture2D(x, uv + d.zy);

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
    gridSize: [1./SIZE, 1./SIZE],
  },

  framebuffer: regl.prop('framebuffer'),
});

// Calculates div*Velocity from Velocity.
const divergence = myregl({
  frag: `
  precision mediump float;
  uniform sampler2D velocity;
  uniform vec2 gridSize;
  varying vec2 uv;

  void main() {
    vec3 d = vec3(gridSize.xy, 0.);
    float vL = texture2D(velocity, uv - d.xz).x;
    float vR = texture2D(velocity, uv + d.xz).x;
    float vB = texture2D(velocity, uv - d.zy).y;
    float vT = texture2D(velocity, uv + d.zy).y;
    float div = (vR - vL + vT - vB) * .5;
    gl_FragColor = vec4(div);
  }`,

  uniforms: {
    velocity: regl.prop('velocity'),
    gridSize: [1./SIZE, 1./SIZE],
  },

  framebuffer: regl.prop('framebuffer'),
});

// w = u - grad P;
const subtractPressure = myregl({
  frag: `
  precision mediump float;
  uniform sampler2D pressure;
  uniform sampler2D velocity;
  uniform vec2 gridSize;
  varying vec2 uv;

  void main() {
    vec3 d = vec3(gridSize.xy, 0.);
    float pL = texture2D(pressure, uv - d.xz).x;
    float pR = texture2D(pressure, uv + d.xz).x;
    float pB = texture2D(pressure, uv - d.zy).x;
    float pT = texture2D(pressure, uv + d.zy).x;
    vec2 uNew = texture2D(velocity, uv).xy;
    uNew -= vec2(pR - pL, pT - pB) * .5;
    gl_FragColor = vec4(uNew, 0., 1.);
  }`,

  uniforms: {
    pressure: regl.prop('pressure'),
    velocity: regl.prop('velocity'),
    gridSize: [1./SIZE, 1./SIZE],
  },

  framebuffer: regl.prop('framebuffer'),
});

// TODO: remove?
const clearProgram = myregl({
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
    value: 0.,
  },

  framebuffer: regl.prop('framebuffer'),
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

//  framebuffer: regl.prop('framebuffer'),
})

function doJacobi(count, x, p) {
  for (var i = 0; i < count; i++) {
    jacobi(extend(p, {x: x.src, rBeta: 1. / p.beta, framebuffer: x.dst}));
    x.swap();
  }
}

function computePressure() {
  divergence({velocity: velocity.dst, framebuffer: divVelocity});
  doJacobi(50, pressure, {b: divVelocity, alpha: -1, beta: 4});
}

regl.frame(function () {
  regl.clear({
    color: [0, 0, 0, 1]
  })
  regl.clear({color: [0, 0, 0, 0], framebuffer: pressure.src});

  advect({velocity: velocity.src, quantity: velocity.src, framebuffer: velocity.dst});
  advect({velocity: velocity.src, quantity: ink.src, framebuffer: ink.dst});

  if (mouse.isDown) {
    applyForce({color: [10*mouse.delta[0], 10*mouse.delta[1], 0.], framebuffer: velocity.dst});
    applyForce({color: mouse.color, framebuffer: ink.dst});
  }

  computePressure();
  velocity.swap();
  subtractPressure({velocity: velocity.src, pressure: pressure.dst, framebuffer: velocity.dst});

  draw({quantity: ink.dst});
  // draw({quantity: velocity.dst});
  velocity.swap();
  ink.swap();
})
