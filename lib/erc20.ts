import { parseAbi, parseAbiItem } from "viem";

export const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);
