import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "graphs",
  title: "Network Graphs",
  category: "visual",
  blurb: "Explore a network: tap a node to see what it connects to.",
  setups: [
    {
      setup: "solo",
      kinds: ["panel", "pair", "wall", "kiosk", "screen"],
      note: "A screen alone is not touchable, so it walks through the graph by itself.",
    },
  ],
  // Kept in step with `graphs.ts` by a unit test; a manifest imports nothing.
  variants: [
    {
      id: "foodweb",
      title: "Food web",
      blurb: "Who eats whom on a Queensland coast, from plankton to sharks.",
    },
    {
      id: "rail",
      title: "Brisbane rail",
      blurb: "Main stations on Brisbane's suburban trains, from Ipswich to the Gold Coast.",
    },
    {
      id: "voyages",
      title: "Great voyages",
      blurb: "Five famous sea voyages, port by port, on a map of the world.",
    },
    {
      id: "internet",
      title: "How the internet connects",
      blurb: "The path a web page takes, from your phone to the server that holds it.",
    },
    {
      id: "elements",
      title: "Elements and everyday things",
      blurb: "Which chemical elements make water, salt, rust, sugar and other familiar things.",
    },
    {
      id: "solar",
      title: "Sun, planets and moons",
      blurb: "What orbits what, from the Sun to the planets and their moons.",
    },
    {
      id: "lineage",
      title: "Teachers and students",
      blurb: "Who taught whom, from Weierstrass to Hawking: a family tree of ideas.",
    },
  ],
  options: [
    {
      type: "enum",
      key: "level",
      title: "What visitors can do",
      values: [
        { id: "auto", title: "Touch where the display allows it" },
        { id: "display", title: "Look only" },
        { id: "touch", title: "Touch the graph" },
        { id: "panels", title: "Touch, with find, view buttons and the info panel" },
      ],
      default: "auto",
    },
    {
      type: "boolean",
      key: "doubleTap",
      title: "Double tap shows only a node's neighbours",
      default: false,
      when: { key: "level", is: ["auto", "touch"] },
    },
    {
      type: "boolean",
      key: "card",
      title: "Show a card for the picked node",
      default: true,
      when: { key: "level", is: ["auto", "display", "touch"] },
    },
    {
      type: "boolean",
      key: "layouts",
      title: "A button to try other layouts",
      default: true,
      when: { key: "level", is: ["auto", "touch", "panels"] },
    },
    { type: "boolean", key: "tour", title: "Walk through the graph when idle", default: true },
    {
      type: "number",
      key: "tourSeconds",
      title: "Seconds per step on the walk",
      min: 3,
      max: 20,
      step: 1,
      default: 7,
      when: { key: "tour", is: [true] },
    },
    {
      type: "boolean",
      key: "rotate",
      title: "Change graph each time it goes idle",
      default: false,
    },
  ],
  network: "none",
  thumb: {
    kind: "kiosk",
    seconds: 8,
    looks: [
      { variant: "lineage", seconds: 4 },
      { variant: "voyages", seconds: 4 },
    ],
  },
};

export default manifest;
