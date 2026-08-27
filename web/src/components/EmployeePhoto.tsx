import { type ReactNode, useEffect, useState } from 'react';

import { apiClient } from '../services/api';

interface EmployeePhotoProps {
  employeeId: string;
  photoUrl: string;
  alt?: string;
  fallback: ReactNode;
}

function requiresAuthenticatedFetch(photoUrl: string) {
  return photoUrl.startsWith('/') || photoUrl.includes('.private.blob.vercel-storage.com/');
}

export function EmployeePhoto({ employeeId, photoUrl, alt = '', fallback }: EmployeePhotoProps) {
  const [resolvedUrl, setResolvedUrl] = useState(
    requiresAuthenticatedFetch(photoUrl) ? '' : photoUrl,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setFailed(false);

    if (!requiresAuthenticatedFetch(photoUrl)) {
      setResolvedUrl(photoUrl);
      return () => undefined;
    }

    setResolvedUrl('');
    void apiClient.employeePhoto(employeeId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setResolvedUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [employeeId, photoUrl]);

  if (!resolvedUrl || failed) return <>{fallback}</>;
  return <img src={resolvedUrl} alt={alt} onError={() => setFailed(true)} />;
}
