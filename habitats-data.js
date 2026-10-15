/* ============================================================
   D.A.B.S.y — habitats-data.js   (MAGIC WORLD data)
   Everything the world engine knows about the artwork lives here, as DATA:

     character   how the supplied DABSy layers fit together. The numbers are
                 pixels in the supplied "body" image's own frame and were
                 measured against the supplied full-character image (eyes drawn
                 at 0.60x, bow at 0.32x). See assets/magic/README.md.
     habitats    one entry per supplied room. Each has:
                   variants  { night:{src,...}, day:null }   null = that artwork
                             was NOT supplied. The engine never fakes one (no CSS
                             colour filter); the Day control stays honest.
                   focus     which part of the picture stays visible when a
                             different screen shape crops it (0..1)
                   spots     where DABSy can stand. x,y are the spot's FEET
                             position as a fraction of the picture (0..1);
                             s is her scale there (smaller = further away).
                             Exactly one spot is HOME.
                   lights    soft lamp glows that breathe slowly (night only).

   v10.2: three illustrated rooms (bed, desk, window sill) were added with a real day AND night picture each
   (habitat-scenes.js). Their sitting spots are derived from the object geometry defined there, so she is
   placed on the pillow / desk / sill itself. The supplied photo room only has night artwork; its Day look is
   a clearly-labelled daylight grade of the same picture (`day:{from:"night",grade:"day"}`), not a new picture.

   To add a room: drop its image(s) in assets/magic/, append an object to
   `habitats`, list its spots. To add its day version: replace `day:null` with
   {src,w,h} and (optionally) its own `lights`. No engine code changes.
   ============================================================ */
(function(){
  window.DABSy = window.DABSy || {};
  const A = "./assets/magic/";
  const SC = window.DABSy.scenes, G = SC.G;
  window.DABSy.worldData = {
    assets: A,
    character: {
      bodyW: 279, bodyH: 251,
      eyeL: { x: 74.0,  y: 91.6, w: 61.8, h: 91.2 },
      eyeR: { x: 164.0, y: 91.0, w: 59.4, h: 90.0 },
      bow:  { x: 117,   y: 190,  w: 67.52, h: 36.16 },
      halo: { pad: 26 },
      flecks: { x: -28, y: 15, w: 342, h: 234 },
      files: { body: "dabsy-body.webp", eyeL: "dabsy-eye-l.webp", eyeR: "dabsy-eye-r.webp", bow: "dabsy-bow.webp", halo: "dabsy-halo.webp", flecks: "dabsy-flecks.webp" },
    },
    habitats: [
      {
        id: "bed", name: "Cosy bed", blurb: "Curled up on the pillow",
        w: SC.W, h: SC.H, scene: true, focus: { x: .5, y: .78 }, baseBodyFrac: .29,
        variants: {
          night: { get src(){ return SC.src("bed", "night"); }, lights: [ { x: 650 / 720, y: 1060 / 1560, r: .34, c: "255,190,110", a: .34, d: 0 } ] },
          day:   { get src(){ return SC.src("bed", "day"); } },
        },
        spots: [
          { id: "pillow",   label: "the pillow",       x: (G.bed.pillow.x + G.bed.pillow.w / 2) / SC.W, y: G.bed.pillow.top / SC.H, s: 1.00, home: true },
          { id: "blanket",  label: "the blanket",      x: (G.bed.blanket.x + G.bed.blanket.w * .62) / SC.W, y: G.bed.blanket.top / SC.H, s: .95 },
          { id: "sill",     label: "the window sill",  x: (G.bed.sill.x + G.bed.sill.w / 2) / SC.W, y: G.bed.sill.top / SC.H, s: .55 },
        ],
      },
      {
        id: "desk", name: "Study desk", blurb: "Resting on the desk", w: 704, h: 1520, focus: { x: .5, y: .80 }, baseBodyFrac: .27,
        variants: {
          night: { src: A + "desk-night.webp", lights: [ { x: .38, y: .77, r: .34, c: "255,190,110", a: .20, d: 0 } ] },
          day:   { src: A + "desk-day.webp" },
        },
        spots: [
          { id: "desk",   label: "the desk beside her notebook", x: .50, y: .800, s: 1.00, home: true },
          { id: "books",  label: "the stack of books",           x: .10, y: .748, s: .84 },
          { id: "sill",   label: "the window ledge",             x: .56, y: .668, s: .58 },
        ],
      },
      {
        id: "window-nook",
        name: "Moonlit window nook", blurb: "The supplied artwork",
        w: 704, h: 1520,
        variants: {
          night: {
            src: A + "room-night.webp",
            lights: [
              { x: .145, y: .700, r: .30, c: "255,170,84",  a: .30, d: 0 },
              { x: .272, y: .685, r: .13, c: "255,196,120", a: .26, d: -2.4 },
              { x: .212, y: .705, r: .10, c: "255,190,110", a: .22, d: -4.1 },
            ],
          },
          day: { src: A + "room-day.webp" },
        },
        focus: { x: .5, y: .80 },
        baseBodyFrac: .30,
        spots: [
          { id: "cushion",  label: "the lavender cushion", x: .520, y: .915, s: 1.00, home: true },
          { id: "blanket",  label: "the soft blanket",     x: .285, y: .897, s: .94 },
          { id: "rug",      label: "the rug by the slippers", x: .170, y: .962, s: 1.04 },
          { id: "desk",     label: "the desk",             x: .585, y: .806, s: .72 },
          { id: "sill",     label: "the window sill",      x: .755, y: .742, s: .60 },
        ],
      },
      {
        id: "lake", name: "Lakeside", blurb: "On the warm rocks by the water", w: 704, h: 1520, focus: { x: .5, y: .78 }, baseBodyFrac: .25,
        variants: {
          night: { src: A + "lake-night.webp", lights: [] },
          day:   { src: A + "lake-day.webp" },
        },
        spots: [
          { id: "rock",    label: "the big warm rock",      x: .50, y: .655, s: .80, home: true },
          { id: "ledge",   label: "the lower rock ledge",   x: .67, y: .716, s: .90 },
          { id: "meadow",  label: "the flower meadow",      x: .17, y: .880, s: 1.05 },
          { id: "shore",   label: "the shore path",         x: .64, y: .930, s: 1.05 },
        ],
      },
    ],
  };
})();
