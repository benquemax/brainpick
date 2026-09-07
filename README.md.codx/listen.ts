import * as fs from 'fs';
import * as path from 'path';

const EPISODE = 'docs/assets/audio/brainpick-episode';

export const content = `## Listen instead

Five minutes, one voice, no slides: the bet, what a brain is, why the
associations are made at write time, and the two commands that get you
started. Synthesized from the transcript beside it — no human was recorded.

**▶ [Play the episode (mp3, 5 min)](https://benquemax.github.io/brainpick/assets/audio/brainpick-episode.mp3)**
· [transcript](https://github.com/benquemax/brainpick/blob/main/docs/assets/audio/brainpick-episode.txt)

`;

export const validate = async () => {
  const root = path.join(__dirname, '..');
  const mp3 = path.join(root, `${EPISODE}.mp3`);
  const txt = path.join(root, `${EPISODE}.txt`);
  if (!fs.existsSync(mp3)) throw new Error(`The episode the README links is missing: ${EPISODE}.mp3`);
  if (!fs.existsSync(txt)) throw new Error(`The episode's transcript is missing: ${EPISODE}.txt`);

  // The episode is about the README: the two onboarding commands it speaks must
  // still be the ones the quick start prints, and its claims must be the hypothesis's.
  const transcript = fs.readFileSync(txt, 'utf-8');
  for (const said of ['henxels init', 'brainpick init', 'brainpick dash brain', 'kilowatt hour', 'write time', 'LightRAG']) {
    if (!transcript.includes(said)) throw new Error(`The episode transcript no longer says "${said}" — re-record or fix the claim`);
  }

  // The static site ships docs/assets/ to Pages; the mp3 link depends on that copy step.
  const site = fs.readFileSync(path.join(root, 'scripts', 'build-static-site.mjs'), 'utf-8');
  if (!/cpSync\(assets, join\(out, 'assets'\)/.test(site)) {
    throw new Error('build-static-site.mjs no longer copies docs/assets/ to Pages — the episode link would 404');
  }
};

export const errorContent = `
[Validation Failed] The "Listen instead" section points at an episode that is missing or drifted.

docs/assets/audio/brainpick-episode.{mp3,txt} must exist, the transcript must
still speak the current onboarding commands and the hypothesis's claims, and the
static-site build must still ship docs/assets/ to Pages.
`;
