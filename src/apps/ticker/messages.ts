/**
 * What the rings say. Every general fact is checked against a published source; facts about the
 * ball come from the frame's own sphere, so they stay true on any ball. No real people, no brands, sentence case, no emoji.
 */
import type { SphereInfo } from "../../core/types";

/** Short greetings and friendly lines that fit any ring. */
export const GREETINGS: readonly string[] = [
  "Hello",
  "Welcome",
  "Hello down there",
  "Look up",
  "Wave to someone across the ball",
  "Walk all the way round",
  "Stand underneath and look up",
  "Can you find where the words begin?",
  "Say hello to someone new",
  "Thanks for visiting",
  "Have a great day",
  "Hello from up here",
  "Nice to see you",
  "Come back soon",
];

/** General facts for children, each checked against a published source. */
export const FACTS: readonly string[] = [
  "The Sun is the star closest to Earth",
  "Sunlight takes about eight minutes to reach Earth",
  "Jupiter is the biggest planet in our solar system",
  "Venus is the hottest planet in our solar system",
  "Saturn's rings are made mostly of ice",
  "Earth takes about 365 days to go once round the Sun",
  "The Moon is just over a quarter as wide as Earth",
  "Light travels about 300,000 kilometres every second",
  "Sound travels about one kilometre in three seconds",
  "Octopuses have three hearts",
  "Blue whales are the biggest animals known to have lived",
  "Platypuses and echidnas are mammals that lay eggs",
  "An echidna's spines are a kind of hair",
  "Hummingbirds can fly backwards",
  "Bats are the only mammals that can really fly",
  "Koalas sleep up to 20 hours a day",
  "The cheetah is the fastest animal on land",
  "Most adults have 206 bones",
  "Plants make their food from sunlight, water and air",
  "Neat snowflakes have six sides or six arms",
  "Rainbows form when sunlight bends and bounces in raindrops",
  "The Pacific is the biggest ocean on Earth",
  "Diamonds are made of carbon",
  "Water boils at 100 degrees Celsius at sea level",
];

/** A length in metres, to one decimal place without a trailing zero. */
const metres = (m: number): string => {
  const r = Math.round(m * 10) / 10;
  const text = Number.isInteger(r) ? String(r) : r.toFixed(1);
  return `${text} ${r === 1 ? "metre" : "metres"}`;
};

/**
 * True things about this ball, from the frame's sphere. `speedM` is how fast the ring's words
 * move, in metres a second.
 */
export const ballFacts = (s: SphereInfo, speedM: number): string[] => {
  const d = 2 * s.radius;
  const lowest = s.centreY - s.radius;
  const out = [
    `This ball is ${metres(d)} across`,
    `It is about ${metres(Math.round(Math.PI * d))} round its middle`,
    `Its top is about ${metres(s.centreY + s.radius)} above the floor`,
  ];
  if (lowest >= 0.5) out.push(`Its lowest point is ${metres(lowest)} above the floor`);
  const cm = Math.round((speedM * 100) / 5) * 5;
  if (cm >= 5) out.push(`These words move about ${cm} centimetres every second`);
  return out;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "The time is 3:05 pm", in the frame's own time zone. */
export const timeLine = (ms: number): string => {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `The time is ${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

/** "Today is Monday 2 November". */
export const dateLine = (ms: number): string => {
  const d = new Date(ms);
  return `Today is ${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
