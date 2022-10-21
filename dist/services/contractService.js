const axios = require("axios");
const Web3 = require("web3");
const { BigNumber } = require("ethers");

const NFTMarketplace_metadata = require("../../public/contracts/NFTMarketplace_metadata.json");
const ERC20_ABI = require("../../public/contracts/ERC20_ABI.json");
const Base_metadata = require("../../public/contracts/Base_metadata.json");

const PROTOCOL_CONTRACTS = {
  4: "0x36ACbdcBf366558AD8c6Be12F217Dc64f78d7B72",
  80001: "0xFfe8B49e11883De88e110604DA018572b93f9f24",
  5: "0x80cdE9aD3355c572778070D5d60CEfef04B227f1",
};

const metaversesJson = [
  {
    id: "0",
    icon: "decentraland.svg",
    name: "Decentraland",
    slug: "decentraland",
    price: 600,
  },
  {
    id: "1",
    icon: "sandbox.svg",
    name: "The Sandbox",
    slug: "sandbox",
    price: 200,
  },
  {
    id: "2",
    icon: "somnium.svg",
    name: "Somnium Space",
    slug: "somnium_space",
    price: 200,
  },
  {
    id: "3",
    icon: "cryptovoxels.svg",
    name: "Cryptovoxels",
    slug: "cryptovoxels",
    price: 170.01,
  },
];

const ENDPOINTS = {
  4: process.env.NEXT_PUBLIC_RINKEBY_ENDPOINT,
  5: process.env.NEXT_PUBLIC_GOERLI_ENDPOINT,
};

const GATEWAY = "styleprotocol.mypinata.cloud";

const validateMetaverseFilter = (metaverseFilter) => {
  if (typeof metaverseFilter === "string") {
    metaverseFilter = [metaverseFilter];
  } else if (metaverseFilter.length === 0) {
    metaverseFilter.push(null);
  }

  const availiableMetaverses = metaversesJson.map((m) => m.slug.toLowerCase());
  if (metaverseFilter.length == 1 && metaverseFilter[0] == null) {
  } else {
    metaverseFilter = new Set(metaverseFilter.map((m) => m.toLowerCase()));
    for (const m of metaverseFilter) {
      if (!availiableMetaverses.includes(m)) {
        return false;
      }
    }
  }

  return Array.from(metaverseFilter);
};

const validateTypeFilter = (typeFilter) => {
  if (typeof typeFilter === "string") {
    typeFilter = [typeFilter];
  } else if (typeFilter.length === 0) {
    typeFilter.push(null);
  }

  const availiableTypes = ["AVATAR", "WEARABLE", "MISC"];

  if (typeFilter.length == 1 && typeFilter[0] == null) {
  } else {
    typeFilter = new Set(typeFilter.map((m) => m.toUpperCase()));
    for (const m of typeFilter) {
      if (!availiableTypes.includes(m)) {
        return false;
      }
    }
  }

  return Array.from(typeFilter);
};

const validateSubtypeFilter = (subtypeFilter) => {
  if (typeof subtypeFilter === "string") {
    subtypeFilter = [subtypeFilter];
  } else if (subtypeFilter.length === 0) {
    subtypeFilter.push(null);
  }

  subtypeFilter = new Set(subtypeFilter);

  return Array.from(subtypeFilter);
};

const getRequestedNFTs = async ({
  cursor = 0,
  amount = 100,
  chainId = 5,
  metaverseFilter = [],
  typeFilter = [],
  subtypeFilter = [],
}) => {
  try {
    metaverseFilter = validateMetaverseFilter(metaverseFilter);
    typeFilter = validateTypeFilter(typeFilter);
    subtypeFilter = validateSubtypeFilter(subtypeFilter);

    if (metaverseFilter === false || typeFilter === false) {
      console.log("improper filter");
      return [];
    }

    const web3 = new Web3(new Web3.providers.HttpProvider(ENDPOINTS[chainId]));
    const protocolContract = new web3.eth.Contract(
      NFTMarketplace_metadata["output"]["abi"],
      PROTOCOL_CONTRACTS[chainId]
    );

    const stakes = (
      await protocolContract.methods.getStakes(cursor, amount).call()
    )[0];

    var stakesData = {};
    stakes.forEach((stake) => {
      stakesData[`${stake.tokenAddress.toLowerCase()}|${stake.tokenId}`] =
        stake;
    });

    const getNFTs = async (url) => {
      var config = {
        method: "get",
        url: url,
        headers: {
          "Content-Type": "application/json",
          pinata_api_key: process.env.NEXT_PUBLIC_PINATA_API_KEY,
          pinata_secret_api_key: process.env.NEXT_PUBLIC_PINATA_SECRET_API_KEY,
        },
      };
      let resultTmp = await axios(config);
      return resultTmp.data.rows;
    };

    let url = `https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=1000&metadata[name]=NonmintedNFT&metadata[keyvalues]={"chainId": {"value": "${chainId}", "op": "eq"}`;

    if (metaverseFilter[0] != null) {
      url += `, "metaverse": {"value": "${metaverseFilter.join(
        "|"
      )}", "op": "regexp"}`;
    }
    if (typeFilter[0] != null) {
      url += `, "type": {"value": "${typeFilter.join("|")}", "op": "regexp"}`;
    }
    if (subtypeFilter[0] != null) {
      url += `, "subtype": {"value": "${subtypeFilter.join(
        "|"
      )}", "op": "regexp"}`;
    }

    url += "}";

    let result = await getNFTs(url);

    let resultGot = await Promise.all(
      result.map((cur) => fetch(`https://${GATEWAY}/ipfs/${cur.ipfs_pin_hash}`))
    );
    resultGot = await Promise.all(resultGot.map((cur) => cur.json()));

    const decimals = [];
    for (let cur of resultGot) {
      try {
        decimals.push(
          await new web3.eth.Contract(ERC20_ABI, cur.paymentToken).methods
            .decimals()
            .call()
        );
      } catch (e) {
        decimals.push(null);
      }
    }

    const resultGotNew = [];
    for (let i = 0; i < resultGot.length; i++) {
      try {
        if (decimals[i] !== null) {
          resultGotNew.push({
            ...resultGot[i],
            payment: {
              value: BigNumber.from(resultGot[i].payment),
              stringValue: `${
                Number.parseInt(resultGot[i].payment) / 10 ** decimals[i]
              }`,
            },
          });
        }
      } catch (e) {}
    }

    const values = await Promise.all([
      Promise.all(
        resultGotNew.map((cur) => {
          return new web3.eth.Contract(ERC20_ABI, cur.paymentToken).methods
            .name()
            .call();
        })
      ),
      Promise.all(
        resultGotNew.map((cur) => {
          return new web3.eth.Contract(ERC20_ABI, cur.paymentToken).methods
            .symbol()
            .call();
        })
      ),
    ]);

    for (let i = 0; i < resultGotNew.length; i++) {
      resultGotNew[i].paymentToken = {
        address: resultGotNew[i].paymentToken,
        name: values[0][i],
        symbol: values[1][i],
      };
    }

    let resExtras = [];
    let allDataParsed = [];
    resultGotNew.forEach((cur) => {
      const curStake =
        stakesData[
          `${cur.tokenAddress.toLowerCase()}|${BigNumber.from(
            cur.tokenId
          ).toNumber()}`
        ];

      if (Number.parseInt(curStake?.numberOfDerivatives) > 0) {
        var ipfsUrl = cur.uri;
        if (ipfsUrl.slice(0, 4) === "ipfs") {
          ipfsUrl = `https://${GATEWAY}/ipfs/${ipfsUrl.slice(7)}`;
        }
        resExtras.push(fetch(ipfsUrl));
        allDataParsed.push(cur);
      }
    });

    resExtras = await Promise.all(resExtras);
    resExtras = await Promise.all(resExtras.map((cur) => cur.json()));

    allDataParsed = allDataParsed.map((data, index) => {
      const curStake =
        stakesData[
          `${data.tokenAddress.toLowerCase()}|${BigNumber.from(
            data.tokenId
          ).toNumber()}`
        ];

      return {
        ...data,
        asset: resExtras[index],
        cid: result[index].ipfs_pin_hash,
        numberOfDerivatives: Number.parseInt(curStake.numberOfDerivatives),
      };
    });

    return allDataParsed;
  } catch (e) {
    console.log(e);
    return [];
  }
};

const getListedNFTs = async ({
  cursor = 0,
  amount = 100,
  chainId = 5,
  metaverseFilter = [],
}) => {
  try {
    metaverseFilter = validateMetaverseFilter(metaverseFilter);

    const web3 = new Web3(new Web3.providers.HttpProvider(ENDPOINTS[chainId]));

    const protocolContract = new web3.eth.Contract(
      NFTMarketplace_metadata["output"]["abi"],
      PROTOCOL_CONTRACTS[chainId]
    );

    const res = (
      await protocolContract.methods.getListings(cursor, amount).call()
    )[0];

    var parsedData = [];
    for (let cur of res) {
      const nftContract = new web3.eth.Contract(
        Base_metadata["output"]["abi"],
        cur.contract_
      );

      const metaverseId = await nftContract.methods.metaverseId().call();
      const metaverseSlug = metaversesJson
        .filter((cur) => cur.id === `${metaverseId}`)[0]
        .slug.toLowerCase();
      if (
        metaverseFilter[0] === "" ||
        metaverseFilter.includes(metaverseSlug)
      ) {
        var data = { ...cur, metaverse: metaverseSlug };

        var ipfsUrl = await nftContract.methods.tokenURI(data.tokenId).call();
        if (ipfsUrl.slice(0, 4) === "ipfs") {
          ipfsUrl = `https://${GATEWAY}/ipfs/${ipfsUrl.slice(7)}`;
        }
        const metadata = await (await fetch(ipfsUrl)).json();

        const tokenContract = new web3.eth.Contract(
          ERC20_ABI,
          data.paymentToken
        );

        const decimals = await tokenContract.methods.decimals().call();

        data.payment = {
          value: BigNumber.from(data.payment),
          stringValue: `${Number.parseInt(data.payment) / 10 ** decimals}`,
        };
        data.paymentToken = {
          address: data.paymentToken,
          name: await tokenContract.methods.name().call(),
          symbol: await tokenContract.methods.symbol().call(),
        };

        parsedData.push({ ...data, asset: metadata });
      }
    }

    return parsedData;
  } catch (e) {
    console.log(e);
    return [];
  }
};

const approveERC20 = async ({ web3, walletAddress, chainId, NFT }) => {
  try {
    const tokenContract = new web3.eth.Contract(
      ERC20_ABI,
      NFT.paymentToken.address
    );

    const allowance = await tokenContract.methods
      .allowance(walletAddress, PROTOCOL_CONTRACTS[chainId])
      .call();

    if (NFT.payment.value.gt(allowance)) {
      await tokenContract.methods
        .approve(PROTOCOL_CONTRACTS[chainId], NFT.payment.value)
        .send({ from: walletAddress });
    }

    return true;
  } catch (e) {
    console.log(e);
    return false;
  }
};

const buyItem = async ({ web3, walletAddress, chainId, NFT }) => {
  try {
    const protocolContract = new web3.eth.Contract(
      NFTMarketplace_metadata["output"]["abi"],
      PROTOCOL_CONTRACTS[chainId]
    );

    await protocolContract.methods
      .buyItem(NFT.contract_, NFT.tokenId, NFT.payment.value)
      .send({ from: walletAddress });

    return true;
  } catch (e) {
    console.log(e);
    return false;
  }
};

const buyAndMintItem = async ({ web3, walletAddress, chainId, NFT }) => {
  try {
    const protocolContract = new web3.eth.Contract(
      NFTMarketplace_metadata["output"]["abi"],
      PROTOCOL_CONTRACTS[chainId]
    );

    await protocolContract.methods
      .buyAndMint(
        walletAddress,
        {
          tokenAddress: NFT.tokenAddress,
          tokenId: NFT.tokenId,
          payment: NFT.payment.value,
          paymentToken: NFT.paymentToken.address,
          uri: NFT.uri,
          bidder: NFT.bidder,
          environment: NFT.environment,
          metaverseId: NFT.metaverseId,
          signature: NFT.signature,
        },
        NFT.adminSignature,
        NFT.payment.value
      )
      .send({ from: walletAddress });

    return true;
  } catch (e) {
    console.log(e);
    return false;
  }
};

exports.getRequestedNFTs = getRequestedNFTs;
exports.getListedNFTs = getListedNFTs;
exports.approveERC20 = approveERC20;
exports.buyItem = buyItem;
exports.buyAndMintItem = buyAndMintItem;
