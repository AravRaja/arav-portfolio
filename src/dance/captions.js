// Caption variants under the dancer. One type treatment for all of them (the welcome page's
// mono label style): a short muted uppercase line.
export const CAPTIONS = [
  { text: 'RL-trained humanoid · 602 hip-hop moves' },
  { text: 'trained, not animated' },
  { text: 'a policy, dancing' },
  // the no-mocap-first -> motion-data story in 7 words: phase 1 learned from the song alone,
  // phase 2 imitated AIST++ dancers
  { text: 'first just the song, then real dancers' },
  // with the sim reveal wipe: drag across and the crew turns into the MuJoCo bodies they were trained as
  { text: 'RL-trained in MuJoCo · I think dancers are safe for now...' },
  // the 25 mostly move as one (the unison choreography), and they are one policy replayed: the hivemind
  { text: 'The Hivemind - trained in MuJoCo' },
];

// the home page's caption (the lab can still cycle through all of them)
export const DEFAULT_CAPTION = 5;
