import { Header, MapView } from "../../components/index.js";

// What rab opens on: the map, and everything out for rent standing on it.
export default function HomePage() {
  return (
    <div className="home-page">
      <Header />
      <main className="home-main">
        <MapView />
      </main>
    </div>
  );
}
