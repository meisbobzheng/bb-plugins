const FALLBACK_TOPIC = "thread";
const MAX_TOPIC_LENGTH = 16;

const NAMES = [
  "ace", "alpaca", "apollo", "astro", "atlas", "avenger",
  "bandit", "baron", "beast", "bison", "blaze", "buddy",
  "captain", "chief", "cobra", "comet", "cosmo", "crusher",
  "dash", "dave", "diesel", "dragon", "duke", "dynamo",
  "eagle", "echo", "eddie", "elf", "ember", "enigma",
  "falcon", "fizz", "flash", "fox", "frank", "fury",
  "gator", "giant", "gizmo", "goblin", "guru", "gus",
  "hammer", "hank", "hawk", "hero", "hornet", "husky",
  "icon", "igor", "imp", "inferno", "iris", "ivy",
  "jaguar", "jedi", "jester", "jet", "jojo", "joker",
  "kevin", "kite", "knight", "koala", "kong", "kraken",
  "lark", "larry", "legend", "lion", "luna", "lynx",
  "mango", "maverick", "meteor", "mojo", "monk", "moose",
  "narwhal", "ned", "ninja", "nomad", "nova", "nugget",
  "ollie", "onyx", "oracle", "orca", "otter", "owl",
  "panda", "penny", "phoenix", "pickle", "pilot", "pirate",
  "quail", "quasar", "queen", "quest", "quinn", "quokka",
  "randy", "ranger", "raven", "rex", "rhino", "rocket",
  "sage", "samurai", "shark", "sparky", "sphinx", "storm",
  "thunder", "tiger", "tina", "titan", "toad", "turbo",
  "ufo", "ulysses", "umpire", "unicorn", "ursa", "usher",
  "viking", "vince", "viper", "vortex", "voyager", "vulture",
  "walrus", "warrior", "wendy", "whiz", "wizard", "wolf",
  "xander", "xena", "xenon", "xray",
  "yak", "yam", "yeti", "yogi", "yoyo", "yukon",
  "zebra", "zen", "zeus", "zippy", "zombie", "zorro",
];

export type FunkyName = { topic: string; name: string };

export const toTopic = (...candidates: (string | null | undefined)[]) =>
  candidates
    .map((candidate) => candidate?.toLowerCase().match(/[a-z0-9]+/)?.[0]?.slice(0, MAX_TOPIC_LENGTH))
    .find(Boolean) ?? FALLBACK_TOPIC;

export function parseFunkyName(title: string): FunkyName | null {
  const [, topic, name] = title.match(/^([a-z0-9]+)-([a-z]+)$/) ?? [];
  return topic && name && NAMES.includes(name) ? { topic, name } : null;
}

const singular = (word: string) => word.replace(/([^s])s$/, "$1");

export function funkyName(topic: string, recent: readonly FunkyName[] = [], random = Math.random) {
  const stem = recent.find((entry) => singular(entry.topic) === singular(topic))?.topic ?? topic;
  const taken = new Set(recent.map((entry) => entry.name));
  const alliterates = (name: string) => name[0] === stem[0];
  const fresh = NAMES.filter((name) => !taken.has(name));
  const pool = [fresh.filter(alliterates), fresh, NAMES.filter(alliterates)].find((names) => names.length > 0) ?? NAMES;
  return `${stem}-${pool[Math.floor(random() * pool.length)]}`;
}
