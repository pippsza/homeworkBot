import { useEffect, useState } from "react";
import { useApi } from "../hooks/useApi";
import { SkeletonList } from "./Skeleton";

export default function RoleGuard({ role, children, fallback }) {
  const { apiFetch } = useApi();
  const [allowed, setAllowed] = useState(null);

  useEffect(() => {
    apiFetch("/users/me")
      .then((u) => {
        if (role === "student") setAllowed(u.isStudent);
        else if (role === "superadmin") setAllowed(u.isSuperadmin);
        else setAllowed(true);
      })
      .catch(() => setAllowed(false));
  }, [role]);

  if (allowed === null) {
    return (
      <div className="p-4">
        <SkeletonList count={3} />
      </div>
    );
  }
  if (!allowed) return fallback || null;
  return children;
}
