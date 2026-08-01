import HomeContent from "../../components/home/HomeContent";
import { useHomeDashboard } from "../../components/home/useHomeDashboard";

export default function MainPage() {
  const { user, loading } = useHomeDashboard();

  return <HomeContent user={user} loading={loading} />;
}

