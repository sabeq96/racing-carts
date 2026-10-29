import { runProbe } from './probe';

const hud = document.getElementById('hud');
if (!hud) throw new Error('missing #hud');

const params = new URLSearchParams(location.search);

if (params.get('probe') === '1') {
  runProbe(hud);
} else {
  // Task 8 replaces this with the real game. Until then the app boots into the probe too.
  runProbe(hud);
}
