import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "xrd",
  title: "X-Ray Diffraction",
  category: "visual",
  blurb:
    "An interactive poster in eleven chapters on how X-rays show us the atoms inside a crystal.",
  setups: [
    {
      setup: "solo",
      kinds: ["panel", "pair", "wall", "kiosk", "screen"],
      note: "A panel or kiosk shows one chapter with tabs; a pair two halves of the poster; a wall six chapters under the machine; a screen alone runs the machine and the simulated maps.",
    },
    {
      setup: "bank",
      kinds: ["panel", "pair", "screen"],
      roles: ["station", "screen"],
      note: "The chapters run along the bank in order, and the screen shows the machine whole, each part over its chapters.",
    },
  ],
  variants: [
    {
      id: "poster",
      title: "Poster",
      blurb: "Eleven chapters, each a question, a figure to play with and a takeaway.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "maths",
      title: "Maths",
      values: [
        { id: "button", title: "Behind a button" },
        { id: "open", title: "Open" },
        { id: "off", title: "Hidden" },
      ],
      default: "button",
    },
    {
      type: "enum",
      key: "chapter",
      title: "Chapter",
      values: [
        { id: "tour", title: "Tour every chapter" },
        // Written out, not imported: manifests load without the app's other modules. A test
        // checks these against ids.ts.
        { id: "spectrum", title: "1 How long is an X-ray?" },
        { id: "interference", title: "2 Can light cancel light?" },
        { id: "crystal", title: "3 What is a crystal?" },
        { id: "bragg", title: "4 Why do crystals flash?" },
        { id: "goniometer", title: "5 How does the machine aim?" },
        { id: "patterns", title: "6 Spots or rings?" },
        { id: "inverse", title: "7 Why do small things make big patterns?" },
        { id: "absences", title: "8 Why are some spots missing?" },
        { id: "synthesis", title: "9 Can we turn spots back into atoms?" },
        { id: "helix", title: "10 What makes an X?" },
        { id: "mystery", title: "11 Which crystal is it?" },
      ],
      default: "tour",
      kinds: ["panel", "pair", "kiosk"],
    },
    {
      type: "enum",
      key: "set",
      title: "Chapters on the wall",
      values: [
        { id: "highlights", title: "Highlights" },
        { id: "first", title: "Chapters 1 to 6" },
        { id: "last", title: "Chapters 6 to 11" },
      ],
      default: "highlights",
      kinds: ["wall"],
    },
    { type: "boolean", key: "maps", title: "Simulated maps", default: true },
    {
      type: "enum",
      key: "wavelength",
      title: "X-ray tube",
      values: [
        { id: "copper", title: "Copper" },
        { id: "cobalt", title: "Cobalt" },
        { id: "molybdenum", title: "Molybdenum" },
      ],
      default: "copper",
    },
  ],
  network: "optional",
  thumb: { kind: "kiosk", seconds: 8 },
};

export default manifest;
