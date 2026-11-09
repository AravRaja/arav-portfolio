// Caption variants under the dancer. One type treatment for all of them (the welcome page's
// bracketed mono label style): a yellow [RL] tag, then a short muted uppercase line.
export const CAPTIONS = [
  { tag: 'RL', text: 'RL-trained humanoid · 602 hip-hop moves' },
  { tag: 'RL', text: 'trained, not animated' },
  { tag: 'RL', text: 'a policy, dancing' },
  // the no-mocap-first -> motion-data story in 7 words: phase 1 learned from the song alone,
  // phase 2 imitated AIST++ dancers
  { tag: 'RL', text: 'first just the song, then real dancers' },
  // with the sim reveal wipe: drag across and the crew turns into the MuJoCo bodies they were trained as
  { tag: 'RL', text: 'RL-trained in MuJoCo · I think dancers are safe for now...' },
];

// the home page's caption (the lab can still cycle through all of them)
export const DEFAULT_CAPTION = 4;
