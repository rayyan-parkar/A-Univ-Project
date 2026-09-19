import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const SPHERE_RADIUS = 1.25;
const SCALED_RADIUS = SPHERE_RADIUS * 0.97;

function Vector({ end, color }) {
  const geomRef = useRef();

  if (!geomRef.current) {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array([0, 0, 0, end.x, end.y, end.z]);
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geomRef.current = geom;
  }

  useEffect(() => {
    const geom = geomRef.current;
    if (!geom) return;
    const pos = geom.attributes.position.array;
    pos[3] = end.x;
    pos[4] = end.y;
    pos[5] = end.z;
    geom.attributes.position.needsUpdate = true;
  }, [end.x, end.y, end.z]);

  useEffect(() => {
    const geom = geomRef.current;
    return () => {
      if (geom) geom.dispose();
    };
  }, []);

  return (
    <group>
      <line geometry={geomRef.current}>
        <lineBasicMaterial color={color} />
      </line>
      <mesh position={[end.x, end.y, end.z]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function WireframeSphere() {
  const meshRef = useRef();

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.2;
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[SPHERE_RADIUS, 32, 24]} />
      <meshBasicMaterial color="#999999" wireframe />
    </mesh>
  );
}

const SphericalGraph = React.memo(function SphericalGraph({ vectorData, title }) {
  const vectorElements = useMemo(() => {
    const vectors = vectorData || [];

    return vectors.map((vector, i) => {
      const x = vector.x || 0;
      const y = vector.y || 0;
      const z = vector.z || 0;
      const mag = Math.hypot(x, y, z) || 1;
      const factor = SCALED_RADIUS / mag;

      const end = {
        x: x * factor,
        y: y * factor,
        z: z * factor,
      };

      return (
        <Vector
          key={i}
          end={end}
          color={vector.color || '#ff6b6b'}
        />
      );
    });
  }, [vectorData]);

  return (
    <div className="spherical-graph">
      <h2>{title}</h2>
      <Canvas
        camera={{ position: [2.5, 2.5, 2.5], fov: 40 }}
        style={{ width: '275px', height: '229px' }}
        dpr={1}
        resize={{ scroll: false, debounce: { scroll: 50, resize: 0 } }}
      >
        <WireframeSphere />
        {vectorElements}
      </Canvas>
    </div>
  );
});

export default SphericalGraph;
