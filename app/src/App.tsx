import { useEffect, useState } from "react";
import { deployment, network } from "./config";
import { TxProvider } from "./lib/tx";
import { WalletProvider } from "./lib/wallet";
import { TxTray } from "./components/TxTray";
import { WalletButton } from "./components/WalletButton";
import { Home } from "./pages/Home";
import { OpenScheme } from "./pages/OpenScheme";
import { SchemePage } from "./pages/SchemePage";

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash.replace(/^#\/?/, "");
}

export function App() {
  const route = useHashRoute();
  const schemeMatch = route.match(/^scheme\/(0x[0-9a-fA-F]{40})$/);

  return (
    <WalletProvider>
      <TxProvider>
        <div className="shell">
          <header className="topbar">
            <a className="wordmark" href="#/">Tola</a>
            <div className="topbar-right">
              <a className="small" href="#/open">Open a plan</a>
              <WalletButton />
            </div>
          </header>
        </div>
        {(network.isTest || deployment?.mocks) && (
          <div className="notice-bar">
            <div className="shell">
              {network.name}{deployment?.mocks ? ", with a test token and a test gold price." : ". Nothing here is on the live chain."}
            </div>
          </div>
        )}
        <main className="shell">
          {schemeMatch ? <SchemePage address={schemeMatch[1]} /> : route === "open" ? <OpenScheme /> : <Home />}
        </main>
        <TxTray />
      </TxProvider>
    </WalletProvider>
  );
}
