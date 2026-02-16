import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useTelegram } from "../hooks/useTelegram";

export default function BackButton({ to }) {
  const navigate = useNavigate();
  const { tg } = useTelegram();

  useEffect(() => {
    tg.BackButton.show();
    const handler = () => navigate(to || -1);
    tg.BackButton.onClick(handler);
    return () => {
      tg.BackButton.offClick(handler);
      tg.BackButton.hide();
    };
  }, [to]);

  return null;
}
