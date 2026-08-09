import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { base } from 'wagmi/chains';
import { http, fallback } from 'wagmi';

const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL;

export const config = getDefaultConfig({
  appName: 'Nexus RWA Protocol',
  projectId: process.env.NEXT_PUBLIC_PROJECT_ID || 'dummy-id-fallback',
  chains: [base],
  transports: {
    [base.id]: fallback([
      ...(BASE_RPC ? [http(BASE_RPC)] : []),
      http('https://mainnet.base.org'),
      http('https://rpc.ankr.com/base'),
      http('https://1rpc.io/base'),
      http('https://base.meowrpc.com'),
    ]),
  },
  ssr: true,
});