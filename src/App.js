import { useState, useEffect, useCallback, useMemo } from "react";
import { ethers } from "ethers";
import MagaTokenLogo from "./MagaToken.png";

// --- Toast Component ---
function Toast({ message, type }) {
  if (!message) return null;
  const color =
    type === "success"
      ? "bg-green-500"
      : type === "error"
      ? "bg-red-500"
      : "bg-yellow-500";
  return (
    <div
      className={`
        ${color}
        px-5 py-3 rounded-xl text-white shadow-lg animate-fade-in
        mx-auto
        w-max
        text-center
      `}
      style={{ minWidth: 220 }}
    >
      {message}
    </div>
  );
}

function App() {
  const [walletAddress, setWalletAddress] = useState("");
  const [ethBalance, setEthBalance] = useState(null);
  const [tokenBalance, setTokenBalance] = useState(null);
  const [symbol, setSymbol] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldownMessage, setCooldownMessage] = useState("");
  const [networkError, setNetworkError] = useState("");
  const [toast, setToast] = useState({ message: "", type: "" });
  const [showDisconnectInfo, setShowDisconnectInfo] = useState(false);

  const tokenAddress = "0xC5A966d1be1cF6a66a130D2D2F2c423BB565D449";

  const tokenInfo = useMemo(
    () => ({
      name: "Maga Token",
      symbol: "MTK",
      description:
        "MagaToken (MTK) — a fun community test token on the Sepolia network. Claim, test, and learn blockchain without risk.",
    }),
    []
  );

  // Toast helper
  const showToast = useCallback((message, type = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: "", type: "" }), 3500);
  }, []);

  const tokenABI = useMemo(
    () => [
      "function balanceOf(address owner) view returns (uint256)",
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
      "function claim()",
      "function lastClaimed(address) view returns (uint256)",
      "function COOLDOWN_TIME() view returns (uint256)",
    ],
    []
  );

  const checkNetwork = useCallback(
    async (provider) => {
      try {
        const { chainId } = await provider.getNetwork();
        if (Number(chainId) !== 11155111) {
          setNetworkError("⚠️ Please switch to the Sepolia Test Network.");
          return false;
        }
        setNetworkError("");
        return true;
      } catch {
        showToast("Failed to detect network.", "error");
        return false;
      }
    },
    [showToast]
  );

  const loadBalances = useCallback(
    async (provider, address) => {
      if (!provider || !address) return;
      if (!(await checkNetwork(provider))) return;

      try {
        const ethBal = await provider.getBalance(address);
        setEthBalance(Number(ethers.formatEther(ethBal)).toFixed(4));

        const token = new ethers.Contract(tokenAddress, tokenABI, provider);
        const [raw, decimals, sym] = await Promise.all([
          token.balanceOf(address),
          token.decimals().catch(() => 18),
          token.symbol().catch(() => "MTK"),
        ]);

        setTokenBalance(Number(ethers.formatUnits(raw, decimals)).toFixed(2));
        setSymbol(sym);

        const last = await token.lastClaimed(address);
        const cooldown = await token.COOLDOWN_TIME();
        const now = Math.floor(Date.now() / 1000);
        const nextClaim = Number(last) + Number(cooldown);

        if (now < nextClaim) {
          const remaining = nextClaim - now;
          const hours = Math.floor(remaining / 3600);
          const minutes = Math.floor((remaining % 3600) / 60);
          const seconds = remaining % 60;
          const parts = [];
          if (hours > 0) parts.push(`${hours}h`);
          if (minutes > 0) parts.push(`${minutes}m`);
          parts.push(`${seconds}s`);
          setCooldownMessage(`⏳ Wait ${parts.join(" ")} before claiming again`);
        } else {
          setCooldownMessage("");
        }
      } catch (err) {
        console.error(err);
        showToast("Failed to load balances.", "error");
      }
    },
    [checkNetwork, tokenABI, showToast, tokenAddress]
  );

  // Connect wallet (called by button or auto-reconnect)
  const connectWallet = useCallback(async (addressOverride = null) => {
    try {
      if (!window.ethereum) return showToast("Please install MetaMask!", "error");
      const provider = new ethers.BrowserProvider(window.ethereum);
      let address = addressOverride;
      if (!address) {
        await provider.send("eth_requestAccounts", []);
        const signer = await provider.getSigner();
        address = await signer.getAddress();
      }
      if (!(await checkNetwork(provider))) return;
      setWalletAddress(address);
      await loadBalances(provider, address);
      showToast("✅ Wallet connected!", "success");
    } catch (err) {
      console.error(err);
      showToast("Connection failed.", "error");
    }
  }, [checkNetwork, loadBalances, showToast]);

  // UI Disconnect (shows soft yellow info only)
  const disconnectWallet = useCallback(() => {
    setShowDisconnectInfo(true);
    setTimeout(() => setShowDisconnectInfo(false), 12000);
  }, []);

  // Claim tokens
  const claimTokens = useCallback(async () => {
    try {
      if (!walletAddress) return showToast("Connect wallet first!", "error");
      setLoading(true);
      const provider = new ethers.BrowserProvider(window.ethereum);
      if (!(await checkNetwork(provider))) return setLoading(false);
      const signer = await provider.getSigner();
      const contractWithSigner = new ethers.Contract(tokenAddress, tokenABI, signer);

      const last = await contractWithSigner.lastClaimed(walletAddress);
      const cooldown = await contractWithSigner.COOLDOWN_TIME();
      const now = Math.floor(Date.now() / 1000);
      const nextClaim = Number(last) + Number(cooldown);

      if (now < nextClaim) {
        const remaining = nextClaim - now;
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = remaining % 60;
        const parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        parts.push(`${seconds}s`);
        showToast(`⏳ Please wait ${parts.join(" ")} before next claim`, "info");
        setLoading(false);
        return;
      }

      const tx = await contractWithSigner.claim();
      await tx.wait();
      await loadBalances(provider, walletAddress);
      showToast("🎉 You successfully claimed 100 MTK!", "success");
    } catch (err) {
      console.error(err);
      showToast("Claim failed — try again later.", "error");
    } finally {
      setLoading(false);
    }
  }, [walletAddress, checkNetwork, tokenABI, showToast, loadBalances]);

  // Listen for account change (MetaMask manual disconnect or switch)
  useEffect(() => {
    if (!window.ethereum) return;
    let previousAddress = walletAddress;

    const handler = (accounts) => {
      if (!accounts.length) {
        // MetaMask manual disconnect: clear all wallet state and info box
        setWalletAddress("");
        setEthBalance(null);
        setTokenBalance(null);
        setSymbol("");
        setCooldownMessage("");
        setShowDisconnectInfo(false);
      } else {
        const provider = new ethers.BrowserProvider(window.ethereum);
        loadBalances(provider, accounts[0]);
        setWalletAddress(accounts[0]);
        setShowDisconnectInfo(false);

        // Show popup for account change only if address changed
        if (previousAddress && previousAddress.toLowerCase() !== accounts[0].toLowerCase()) {
          showToast(
            `Changed to account ${accounts[0].slice(0, 6)}...${accounts[0].slice(-4)}`,
            "success"
          );
        }
        previousAddress = accounts[0];
      }
    };
    window.ethereum.on("accountsChanged", handler);
    return () => window.ethereum.removeListener("accountsChanged", handler);
  }, [loadBalances, showToast, walletAddress]);

  // Auto-reconnect on page load if MetaMask is still connected
  useEffect(() => {
    async function autoReconnect() {
      if (!window.ethereum) return;
      try {
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        if (accounts && accounts.length) {
          connectWallet(accounts[0]);
        }
      } catch (e) {
        // Ignore errors, just don't connect
      }
    }
    autoReconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f172a] via-[#1e1b4b] to-[#0c0a09] text-white flex flex-col">
      {/* Header */}
      <header className="flex flex-col items-center px-6 py-4 border-b border-white/10 backdrop-blur-md bg-white/5">
        <h1 className="text-2xl font-bold tracking-wide text-indigo-300 flex items-center gap-2">
          <img src={MagaTokenLogo} alt="Logo" className="w-8 h-8 rounded-full" />
          {tokenInfo.name} Dashboard
        </h1>
        <p className="text-gray-400 text-sm mt-1 text-center max-w-md">
          {tokenInfo.description}
        </p>
        {networkError && <p className="text-red-400 text-sm mt-2">{networkError}</p>}
        <div className="mt-3 flex flex-col items-center">
          {walletAddress ? (
            <>
              <button
                onClick={disconnectWallet}
                className="bg-red-500 hover:bg-red-600 px-5 py-2 rounded-xl font-semibold transition-all"
              >
                Disconnect
              </button>
              {showDisconnectInfo && (
                <div className="mt-2 bg-yellow-100 text-yellow-800 p-3 rounded-lg text-sm max-w-md text-center animate-fade-in">
                  ⚠️ To fully disconnect, open your wallet (e.g. MetaMask) → Connected Sites → Remove this website.
                </div>
              )}
            </>
          ) : (
            <button
              onClick={() => connectWallet()}
              className="bg-indigo-600 hover:bg-indigo-700 px-5 py-2 rounded-xl font-semibold transition-all"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* Main */}
      <main className="flex-grow flex flex-col items-center justify-center p-6 space-y-6">
        {!walletAddress ? (
          <div className="text-center">
            <h2 className="text-2xl mb-2 text-gray-300">Welcome to {tokenInfo.name}</h2>
            <p className="text-gray-400 text-sm">
              Connect wallet to claim 100 MTK test tokens.
            </p>
          </div>
        ) : (
          <>
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-8 shadow-2xl w-[400px]">
              <div className="text-sm text-gray-400 mb-4 break-all">
                <span className="text-gray-500">Connected:</span> {walletAddress}
              </div>
              <div className="space-y-4">
                <div className="flex flex-col bg-white/10 p-4 rounded-2xl shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <img
                        src="https://cdn.pixabay.com/photo/2021/05/24/09/15/ethereum-logo-6278329_1280.png"
                        alt="ETH"
                        className="w-8 h-8 rounded-full"
                      />
                      <span>Ethereum</span>
                    </div>
                    <span className="text-indigo-300 font-semibold">
                      {ethBalance} ETH
                    </span>
                  </div>
                </div>

                <div className="flex flex-col bg-white/10 p-4 rounded-2xl shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <img src={MagaTokenLogo} alt="MTK" className="w-8 h-8 rounded-full" />
                      <span>{symbol}</span>
                    </div>
                    <span className="text-green-400 font-semibold">
                      {tokenBalance} {symbol}
                    </span>
                  </div>
                  {cooldownMessage && (
                    <p className="text-yellow-400 text-xs mt-2">{cooldownMessage}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="text-center">
              <button
                onClick={claimTokens}
                disabled={loading}
                className={`mt-4 px-6 py-3 rounded-xl font-semibold transition-all ${
                  loading
                    ? "bg-gray-500 cursor-not-allowed"
                    : "bg-green-500 hover:bg-green-600"
                }`}
              >
                {loading ? "Claiming..." : "💰 Claim Free 100 MTK"}
              </button>
              <p className="text-gray-400 text-xs mt-2">
                Claim again after the cooldown ends.
              </p>
            </div>
          </>
        )}
        {/* Toast */}
        <Toast message={toast.message} type={toast.type} />
      </main>

      <footer className="text-center py-4 text-sm text-gray-400 border-t border-white/10">
        Powered by <span className="text-indigo-400 font-semibold">Ethers.js</span> on Sepolia •
        Built by <span className="text-indigo-400 font-semibold">Maga</span> 💎
      </footer>

      <style>
        {`
          @keyframes fade-in {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .animate-fade-in {
            animation: fade-in 0.4s ease-in-out;
          }
        `}
      </style>
    </div>
  );
}

export default App;