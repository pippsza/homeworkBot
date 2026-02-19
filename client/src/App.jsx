import { HashRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { useTelegram } from "./hooks/useTelegram";
import { ToastProvider } from "./components/Toast";
import Layout from "./components/Layout";
import SubjectsList from "./pages/SubjectsList";
import SubjectDetail from "./pages/SubjectDetail";
import TaskDetail from "./pages/TaskDetail";
import InfosList from "./pages/InfosList";
import InfoDetail from "./pages/InfoDetail";
import AdminPanel from "./pages/AdminPanel";
import UserManagement from "./pages/UserManagement";
import SubjectManagement from "./pages/SubjectManagement";
import TaskManagement from "./pages/TaskManagement";
import InfoManagement from "./pages/InfoManagement";
import PromptManagement from "./pages/PromptManagement";
import KnowledgeManagement from "./pages/KnowledgeManagement";
import ModelManagement from "./pages/ModelManagement";

export default function App() {
  const { tg } = useTelegram();

  useEffect(() => {
    tg.ready();
    tg.expand();
  }, []);

  return (
    <ToastProvider>
      <HashRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<SubjectsList />} />
            <Route path="/subjects/:id" element={<SubjectDetail />} />
            <Route path="/tasks/:taskId" element={<TaskDetail />} />
            <Route path="/infos" element={<InfosList />} />
            <Route path="/infos/:id" element={<InfoDetail />} />
            <Route path="/admin" element={<AdminPanel />} />
            <Route path="/admin/users" element={<UserManagement />} />
            <Route path="/admin/subjects" element={<SubjectManagement />} />
            <Route path="/admin/subjects/:id/tasks" element={<TaskManagement />} />
            <Route path="/admin/infos" element={<InfoManagement />} />
            <Route path="/admin/prompts" element={<PromptManagement />} />
            <Route path="/admin/subjects/:id/knowledge" element={<KnowledgeManagement />} />
            <Route path="/admin/models" element={<ModelManagement />} />
          </Routes>
        </Layout>
      </HashRouter>
    </ToastProvider>
  );
}
