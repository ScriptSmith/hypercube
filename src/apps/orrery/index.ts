/**
 * Sun, Earth and Moon. A model of the three in 3D beside the view from the ground.
 *
 * - astro.ts     the astronomy: the Sun's place, declination, day length, the Sun and Moon from
 *                the ground, phases and eclipses
 * - sky.ts       the shared state (date, time, tilt) and what follows from it
 * - tour.ts      the attract tour on the shared clock; keeper.ts who moves the state
 * - wire.ts, link.ts  a bank's claims and state; bank.ts each frame's latitude
 * - layout.ts    where things go; controls.ts fingers on the wheel, dial and sliders
 * - space.ts, ground.ts  the 3D views; overlay.ts and art.ts the 2D canvas over them
 * - land.ts      land and sea from Natural Earth; bots.ts injected touches
 * - app.ts       the frame itself
 */
export { mount } from "./app";
