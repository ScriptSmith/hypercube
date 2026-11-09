import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "spheretest",
  title: "Sphere test",
  category: "tool",
  blurb: "Checks the sphere's 3D helpers: a painted ball turning, then a scene inside the glass.",
  setups: [{ setup: "solo", kinds: ["sphere"] }],
  variants: [
    { id: "cycle", title: "Both in turn", blurb: "The ball, then the scene inside, every 20 s." },
    { id: "ball", title: "Painted ball", blurb: "A ball whose own pattern turns." },
    { id: "inside", title: "Inside the glass", blurb: "A small scene seen from people round it." },
  ],
  network: "none",
  hidden: true,
};

export default manifest;
