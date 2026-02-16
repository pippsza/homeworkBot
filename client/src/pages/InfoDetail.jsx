import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import BackButton from "../components/BackButton";
import AttachmentViewer from "../components/AttachmentViewer";
import { SkeletonDetail } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";

export default function InfoDetail() {
  const { id } = useParams();
  const { apiFetch } = useApi();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/infos/${id}`)
      .then(setInfo)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="p-4">
        <BackButton to="/infos" />
        <SkeletonDetail />
      </div>
    );
  }

  if (!info) {
    return (
      <div className="p-4">
        <BackButton to="/infos" />
        <EmptyState emoji="🔍" title="Информация не найдена" />
      </div>
    );
  }

  return (
    <div className="p-4 page-enter">
      <BackButton to="/infos" />
      <div className="flex items-center gap-3 mb-4">
        <span className="text-3xl">{info.emoji || "ℹ️"}</span>
        <h1 className="text-xl font-bold">{info.title}</h1>
      </div>

      {info.description && (
        <div className="card whitespace-pre-wrap mb-4" style={{ cursor: "default" }}>
          {info.description}
        </div>
      )}

      <AttachmentViewer attachments={info.attachments} />
    </div>
  );
}
