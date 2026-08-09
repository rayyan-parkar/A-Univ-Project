import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Vector component that renders a line with an endpoint with a sphere at that point
function Vector({ start, end, color }) {
  const geometryRef = useRef();
  const geometry = useMemo(() => {
    const points = [start, end];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    return geom;
  }, [start.x, start.y, start.z, end.x, end.y, end.z]);

  useEffect(() => {
    geometryRef.current = geometry;
    return () => {
      // Dispose of geometry when component unmounts
      if (geometryRef.current) {
        geometryRef.current.dispose();
      }
    };
  }, [geometry]);

  return (
    <group>
      <line geometry={geometry}>
        <lineBasicMaterial color={color}/>
      </line>
      <mesh position={[end.x, end.y, end.z]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

// Wireframe sphere that rotates around its own axis
function WireframeSphere({ }) {
  const meshRef = useRef();

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.2; // Rotate around Y axis
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1.25, 32, 24]} />
      <meshBasicMaterial color="#999999" wireframe />
    </mesh>
  );
}

// Main SphericalGraph component
const SphericalGraph = React.memo(function SphericalGraph({vectorData, title}) { 
  
  const vectorElements = useMemo(() => {
    const sphereRadius = 1.25;
    const vectors = vectorData || [];

    return vectors.map((vector, i) => {
      const originalVector = new THREE.Vector3(vector.x, vector.y, vector.z);
      const scaledVector = originalVector.normalize().multiplyScalar(0.97*sphereRadius);
      return (
        <Vector
          key={i}
          start={new THREE.Vector3(0, 0, 0)}
          end={scaledVector}
          color={vector.color || '#ff6b6b'}
        />
      );
    });
  }, [vectorData]);

// Returns the final spherical graph HTML component
return (
    <div className="spherical-graph">
    <h2>{title}</h2>
    <Canvas 
      camera={{ position: [2.5, 2.5, 2.5], fov: 40 }}
      style={{ width: '275px', height: '229px' }}
      dpr={1}
      resize={{ scroll: false, debounce: { scroll: 50, resize: 0 } }}
    >
      <WireframeSphere/>
      {vectorElements}
    </Canvas>
  </div>
);
});

export default SphericalGraph;