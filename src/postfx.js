// Bloom post-processing so pellets, emissive walls and Pac-Man glow.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.4,    // strength (calmer; avoids light pollution)
    0.45,   // radius
    0.72    // threshold (only the brightest emissives glow)
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return { composer, bloom };
}
