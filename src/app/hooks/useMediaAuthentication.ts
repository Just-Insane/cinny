import { useEffect, useState } from 'react';
import { useSpecVersions } from './useSpecVersions';

export const useMediaAuthentication = (): boolean => {
  const { versions, unstable_features: unstableFeatures } = useSpecVersions();

  // Media authentication is introduced in spec version 1.11
  const authenticatedMedia =
    unstableFeatures?.['org.matrix.msc3916.stable'] || versions.includes('v1.11');

  const [hasController, setHasController] = useState(() => {
    if (typeof navigator === 'undefined') return true;
    return !!navigator.serviceWorker?.controller;
  });

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
    const handleControllerChange = () => {
      setHasController(!!navigator.serviceWorker?.controller);
    };
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  return !!authenticatedMedia && hasController;
};
