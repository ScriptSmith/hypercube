/**
 * The curated question list. Visitors only ever answer these; the operator picks a set or a
 * single question through options and admin. Every answer is a picture of our own (pictures.ts)
 * plus a word or two. Content rules: suitable for children, nothing personal, political,
 * religious or commercial, nothing about health, money or appearance, no brands or real people.
 *
 * Ids are stable: they appear in operator URLs (`o.question`) and in stored totals.
 * `bot` weights how often bots pick an answer, so attract and test runs look plausible.
 * `correct` marks the answer a quiz question's reveal shows as right.
 */
import type { PictureId } from "./pictures";

export type SetId = "everyday" | "animals" | "science";
/** Who a question suits, for the two-question variant: children low down, adults above. */
export type Audience = "children" | "everyone" | "adults";

export interface Answer {
  /** Null for an operator's answer shown as its words alone. */
  pic: PictureId | null;
  label: string;
  bot: number;
}

export interface Question {
  id: string;
  set: SetId | "custom";
  text: string;
  audience: Audience;
  answers: readonly Answer[];
  correct?: number;
}

export const SETS: readonly { id: SetId; title: string }[] = [
  { id: "everyday", title: "Everyday" },
  { id: "animals", title: "Animals" },
  { id: "science", title: "Science" },
];

const a = (pic: PictureId, label: string, bot = 1): Answer => ({ pic, label, bot });

export const QUESTIONS: readonly Question[] = [
  // Everyday
  {
    id: "travel",
    set: "everyday",
    text: "How did you get here today?",
    audience: "everyone",
    answers: [
      a("bus", "Bus", 3),
      a("train", "Train", 3),
      a("ferry", "Ferry", 1),
      a("car", "Car", 4),
      a("bike", "Bike", 1),
      a("walk", "Walking", 2),
    ],
  },
  {
    id: "season",
    set: "everyday",
    text: "Which season do you like best?",
    audience: "everyone",
    answers: [
      a("sun", "Summer", 4),
      a("leaf", "Autumn", 2),
      a("snowflake", "Winter", 2),
      a("flower", "Spring", 3),
    ],
  },
  {
    id: "power",
    set: "everyday",
    text: "Which superpower would you pick?",
    audience: "children",
    answers: [
      a("wings", "Flying", 4),
      a("bolt", "Super speed", 3),
      a("invisible", "Invisible", 2),
      a("dumbbell", "Super strong", 2),
    ],
  },
  {
    id: "rainy",
    set: "everyday",
    text: "What is best on a rainy day?",
    audience: "children",
    answers: [
      a("book", "Reading", 2),
      a("pencil", "Drawing", 3),
      a("blocks", "Building", 3),
      a("puzzle", "Puzzles", 2),
    ],
  },
  {
    id: "explore",
    set: "everyday",
    text: "Where would you like to explore?",
    audience: "everyone",
    answers: [
      a("rocket", "Space", 4),
      a("submarine", "Deep sea", 3),
      a("rainforest", "Rainforest", 2),
      a("cactus", "Desert", 1),
      a("mountains", "Mountains", 2),
    ],
  },
  {
    id: "job",
    set: "everyday",
    text: "Which job would you like to try?",
    audience: "everyone",
    answers: [
      a("helmet", "Astronaut", 3),
      a("chefhat", "Chef", 2),
      a("hardhat", "Builder", 1),
      a("plane", "Pilot", 2),
      a("flask", "Scientist", 3),
      a("palette", "Artist", 2),
    ],
  },

  // Animals
  {
    id: "beanimal",
    set: "animals",
    text: "Which animal would you like to be?",
    audience: "everyone",
    answers: [
      a("dolphin", "Dolphin", 3),
      a("elephant", "Elephant", 2),
      a("owl", "Owl", 2),
      a("butterfly", "Butterfly", 2),
      a("turtle", "Turtle", 1),
      a("lion", "Lion", 3),
    ],
  },
  {
    id: "pet",
    set: "animals",
    text: "Which pet would you choose?",
    audience: "children",
    answers: [
      a("dog", "Dog", 4),
      a("cat", "Cat", 3),
      a("fish", "Fish", 2),
      a("rabbit", "Rabbit", 2),
    ],
  },
  {
    id: "meet",
    set: "animals",
    text: "Which animal would you like to meet?",
    audience: "everyone",
    answers: [
      a("koala", "Koala", 3),
      a("kangaroo", "Kangaroo", 3),
      a("platypus", "Platypus", 3),
      a("echidna", "Echidna", 2),
    ],
  },
  {
    id: "sleep",
    set: "animals",
    text: "Which animal sleeps the most?",
    audience: "everyone",
    correct: 0,
    answers: [
      a("koala", "Koala", 3),
      a("cat", "Cat", 3),
      a("horse", "Horse", 1),
      a("giraffe", "Giraffe", 1),
    ],
  },
  {
    id: "insect",
    set: "animals",
    text: "Which one is an insect?",
    audience: "children",
    correct: 1,
    answers: [
      a("spider", "Spider", 3),
      a("ant", "Ant", 3),
      a("snail", "Snail", 1),
      a("worm", "Worm", 1),
    ],
  },
  {
    id: "mammal",
    set: "animals",
    text: "Which one is a mammal?",
    audience: "everyone",
    correct: 1,
    answers: [
      a("shark", "Shark", 2),
      a("dolphin", "Dolphin", 3),
      a("penguin", "Penguin", 2),
      a("turtle", "Turtle", 1),
    ],
  },
  {
    id: "oldest",
    set: "animals",
    text: "Which animal can live the longest?",
    audience: "adults",
    correct: 0,
    answers: [
      a("tortoise", "Tortoise", 3),
      a("elephant", "Elephant", 3),
      a("parrot", "Parrot", 1),
      a("dog", "Dog", 1),
    ],
  },

  // Science
  {
    id: "heavier",
    set: "science",
    text: "Which is heavier: 1 kg of feathers or rocks?",
    audience: "everyone",
    correct: 2,
    answers: [a("feather", "Feathers", 1), a("rock", "Rocks", 4), a("scales", "The same", 2)],
  },
  {
    id: "float",
    set: "science",
    text: "Which one floats in water?",
    audience: "children",
    correct: 0,
    answers: [
      a("apple", "Apple", 2),
      a("rock", "Rock", 1),
      a("key", "Key", 2),
      a("shell", "Shell", 2),
    ],
  },
  {
    id: "rainbow",
    set: "science",
    text: "What makes a rainbow?",
    audience: "children",
    correct: 0,
    answers: [a("sunrain", "Sunny rain", 3), a("wind", "Wind", 1), a("thunder", "Thunder", 1)],
  },
  {
    id: "biggest",
    set: "science",
    text: "Which one is the biggest?",
    audience: "everyone",
    correct: 2,
    answers: [
      a("earth", "Earth", 2),
      a("moon", "Moon", 1),
      a("sun", "Sun", 2),
      a("jupiter", "Jupiter", 3),
    ],
  },
  {
    id: "fastest",
    set: "science",
    text: "Which one is the fastest?",
    audience: "adults",
    correct: 0,
    answers: [
      a("bulb", "Light", 2),
      a("speaker", "Sound", 2),
      a("plane", "Jet plane", 1),
      a("rocket", "Rocket", 3),
    ],
  },
  {
    id: "magnet",
    set: "science",
    text: "What will a magnet pick up?",
    audience: "children",
    correct: 0,
    answers: [
      a("paperclip", "Paper clip", 3),
      a("leaf", "Leaf", 1),
      a("pencil", "Pencil", 1),
      a("duck", "Toy duck", 1),
    ],
  },
  {
    id: "study",
    set: "science",
    text: "What would you most like to study?",
    audience: "everyone",
    answers: [
      a("telescope", "Stars", 3),
      a("dinosaur", "Dinosaurs", 3),
      a("wave", "Oceans", 2),
      a("volcano", "Volcanoes", 3),
      a("robot", "Robots", 2),
    ],
  },
  {
    id: "invent",
    set: "science",
    text: "What would you like to invent?",
    audience: "everyone",
    answers: [
      a("robot", "Robot helper", 2),
      a("flyingcar", "Flying car", 3),
      a("clock", "Time machine", 3),
      a("portal", "Teleporter", 2),
    ],
  },
];

export const MAX_ANSWERS = 6;

const byId = new Map(QUESTIONS.map((q) => [q.id, q]));

/** Operators' questions seen lately (custom.ts), newest last. */
const customs = new Map<string, Question>();
const MAX_CUSTOMS = 8;

/**
 * Know `q` by its id from now on, as the newest custom question; returns the one kept. A copy with
 * words replaces a words-free one (custom.ts `blindQuestion`), never the other way round.
 */
export const rememberCustom = (q: Question): Question => {
  const had = customs.get(q.id);
  const known = had && had.text && !q.text ? had : q;
  customs.delete(q.id);
  customs.set(q.id, known);
  while (customs.size > MAX_CUSTOMS) {
    const oldest = customs.keys().next().value;
    if (oldest === undefined) break;
    customs.delete(oldest);
  }
  return known;
};

export const questionById = (id: string): Question | undefined => byId.get(id) ?? customs.get(id);

export const questionsInSet = (set: SetId): Question[] => QUESTIONS.filter((q) => q.set === set);

/** Child questions sit in the low band of a panel, where only one row of buttons fits. */
export const CHILD_MAX_ANSWERS = 4;

export const suitsChildren = (q: Question): boolean =>
  q.audience !== "adults" && q.answers.length <= CHILD_MAX_ANSWERS;

export const suitsAdults = (q: Question): boolean => q.audience !== "children";
