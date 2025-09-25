export default function Adsense() {
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  const googleAdsenseCode = process.env.NEXT_PUBLIC_GOOGLE_ADCODE;

  if (!googleAdsenseCode) {
    return null;
  }

  return (
    <script
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${googleAdsenseCode}`}
      crossOrigin="anonymous"
    ></script>
  );
}
