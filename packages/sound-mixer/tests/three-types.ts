/**
 * Type pin, checked by `tsc` only: three's real objects and cameras satisfy the structural types
 * `./three` takes, so the package never needs to import three.
 */
import { Mesh, Object3D, OrthographicCamera, PerspectiveCamera } from "three";

import { type Object3DLike, type Position } from "../src/three/index.ts";

export const pins: Object3DLike[] = [
  new Object3D(),
  new Mesh(),
  new PerspectiveCamera(),
  new OrthographicCamera(),
];

export const point: Position = [1, 2, 3];
