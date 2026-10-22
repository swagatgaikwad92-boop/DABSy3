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

   To add a room: drop its image(s) in assets/magic/, append an object to
   `habitats`, list its spots. To add its day version: replace `day:null` with
   {src,w,h} and (optionally) its own `lights`. No engine code changes.
   ============================================================ */
(function(){
  window.DABSy = window.DABSy || {};
  const A = "./assets/magic/";
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
        id: "window-nook",
        name: "Moonlit window nook",
        w: 704, h: 1520,
        variants: {
          night: {
            src: A + "room-night.webp",
            // warm lamp glows (x,y,size as fractions of the picture; c = rgb; a = strength). They only breathe in opacity.
            lights: [
              { x: .145, y: .700, r: .30, c: "255,170,84",  a: .30, d: 0 },
              { x: .272, y: .685, r: .13, c: "255,196,120", a: .26, d: -2.4 },
              { x: .212, y: .705, r: .10, c: "255,190,110", a: .22, d: -4.1 },
            ],
          },
          day: null,                    // no daytime artwork was supplied for this room
        },
        dayHours: [6.5, 18.5],          // what "Auto" treats as daytime (local clock), used only if a day variant exists
        focus: { x: .5, y: .80 },
        baseBodyFrac: .30,              // DABSy's body is ~30 % of the picture's width at scale 1
        spots: [
          { id: "cushion",  label: "the lavender cushion", x: .520, y: .915, s: 1.00, home: true },
          { id: "blanket",  label: "the soft blanket",     x: .285, y: .897, s: .94 },
          { id: "rug",      label: "the rug by the slippers", x: .170, y: .962, s: 1.04 },
          { id: "desk",     label: "the desk",             x: .585, y: .806, s: .72 },
          { id: "sill",     label: "the window sill",      x: .755, y: .742, s: .60 },
        ],
      },
    ],
  };
})();
