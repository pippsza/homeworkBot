import { useEffect, useState } from "react";
import { useApi } from "../hooks/useApi";
import { SkeletonList } from "./Skeleton";

export default function RoleGuard({ role, children, fallback }) {
  const { apiFetch } = useApi();
  const [allowed, setAllowed] = useState(null);

  useEffect(() => {
    apiFetch("/users/me")
      .then((u) => {
        if (role === "admin") setAllowed(u.isAdmin);
        else if (role === "viewer") setAllowed(u.isAnswerViewer);
        else if (role === "superuser") setAllowed(u.isSuperuser);
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
