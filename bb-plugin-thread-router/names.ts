const FALLBACK_TOPIC = "thread";
const MAX_TOPIC_LENGTH = 16;

const NAMES = [
  "ace", "atlas", "avenger",
  "bandit", "baron", "beast",
  "captain", "cosmo", "crusher",
  "dave", "dragon", "dynamo",
  "eagle", "eddie", "ember",
  "falcon", "frank", "fury",
  "goblin", "gus", "guru",
  "hank", "hawk", "hero",
  "icon", "igor", "inferno",
  "jedi", "jester", "jojo",
  "kevin", "knight", "kong",
  "larry", "legend", "lynx",
  "maverick", "mojo", "moose",
  "ned", "ninja", "nomad",
  "ollie", "oracle", "otter",
  "penny", "phoenix", "pirate",
  "quasar", "queen", "quinn",
  "randy", "ranger", "rocket",
  "sage", "samurai", "sparky",
  "tiger", "tina", "titan",
  "ulysses", "unicorn", "ursa",
  "viking", "vince", "vulture",
  "warrior", "wendy", "wizard",
  "xena", "xenon",
  "yak", "yeti", "yogi",
  "zen", "zeus", "zorro",
];

export const toTopic = (...candidates: (string | null | undefined)[]) =>
  candidates
    .map((candidate) => candidate?.toLowerCase().match(/[a-z0-9]+/)?.[0]?.slice(0, MAX_TOPIC_LENGTH))
    .find(Boolean) ?? FALLBACK_TOPIC;

export function funkyName(topic: string, random = Math.random) {
  const alliterative = NAMES.filter((name) => name[0] === topic[0]);
  const pool = alliterative.length > 0 ? alliterative : NAMES;
  return `${topic}-${pool[Math.floor(random() * pool.length)]}`;
}
