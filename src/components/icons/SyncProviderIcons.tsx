// Copyright (c) 2026. Licensed under AGPLv3.
// Cloud provider logos for the sync buttons. Paths from gilbarbara/logos (CC0);
// the marks themselves belong to Google, Microsoft and Dropbox.
import React, { useId } from "react";

type IconProps = React.SVGProps<SVGSVGElement>;

export const GoogleDriveIcon = (props: IconProps) => {
  // Gradient and mask ids must be unique per instance on the page.
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 256 238" preserveAspectRatio="xMidYMid" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <defs>
        <path
          id={`${id}-shape`}
          d="M77.303013,29.2696361 C99.8343226,-9.75577512 156.165677,-9.75731561 178.696987,29.2696361 L248.07019,149.428404 C270.601499,188.455356 242.436592,237.238275 197.372432,237.238275 L58.6275676,237.238275 C13.563408,237.238275 -14.6014992,188.455356 7.92981036,149.428404 L77.303013,29.2696361 Z"
        />
        <linearGradient id={`${id}-yellow`} x1="86.9238621%" y1="94.293942%" x2="7.62952552%" y2="45.9524317%">
          <stop stopColor="#FFE921" offset="9%" />
          <stop stopColor="#FEC700" offset="100%" />
        </linearGradient>
        <linearGradient id={`${id}-blue`} x1="99.5381738%" y1="93.9010829%" x2="23.4369107%" y2="54.0328204%">
          <stop stopColor="#A9A8FF" offset="15%" />
          <stop stopColor="#6D97FF" offset="33%" />
          <stop stopColor="#3186FF" offset="48%" />
        </linearGradient>
        <linearGradient id={`${id}-green`} x1="87.1278959%" y1="51.5184912%" x2="-0.638984139%" y2="93.0781332%">
          <stop stopColor="#0EBC5F" offset="55%" />
          <stop stopColor="#78C9FF" offset="85%" />
        </linearGradient>
        <mask id={`${id}-mask`} fill="white">
          <use href={`#${id}-shape`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-mask)`}>
        <g transform="translate(-42.8696, -58.6696)">
          <polygon fill={`url(#${id}-yellow)`} points="341.719213 295.937182 200.166022 295.937182 170.873471 245.202453 241.650066 122.61278" />
          <polygon fill={`url(#${id}-blue)`} points="0 295.915615 100.069146 122.591213 100.069146 122.594294 70.787379 173.316699 129.357076 173.316699 200.139833 295.912534 0.00154049703 295.914074" />
          <polygon fill={`url(#${id}-green)`} points="170.881173 0 241.66239 122.600456 212.376001 173.325942 70.8120269 173.325942" />
        </g>
      </g>
    </svg>
  );
};

export const OneDriveIcon = (props: IconProps) => (
  <svg viewBox="0 0 256 165" preserveAspectRatio="xMidYMid" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
    <path fill="#0364B8" d="M154.66056,110.681557 L207.502052,60.1479482 C196.525811,17.3487078 152.932256,-8.44908883 110.132767,2.52715287 C90.8589801,7.46999082 74.1187452,19.4179992 63.179535,36.0386895 C63.9974594,36.0180612 154.66056,110.681557 154.66056,110.681557 Z" />
    <path fill="#0078D4" d="M97.6181022,45.5520619 L97.6156169,45.5607606 C87.5186874,39.307156 75.8741386,36.001658 63.9972108,36.0177537 C63.7228296,36.0177537 63.4531706,36.03521 63.1792865,36.0384409 C27.8517142,36.4761088 -0.432413365,65.4695515 0.00500592252,100.797124 C0.163570414,113.612018 4.16769663,126.083687 11.4981977,136.595916 L90.6631356,126.680913 L151.357298,77.7409022 L97.6181022,45.5520619 Z" />
    <path fill="#1490DF" d="M207.502052,60.1481967 C206.340406,60.0706542 205.173043,60.016946 203.992011,60.016946 C196.903085,60.010012 189.887973,61.4579693 183.381112,64.271122 L183.379621,64.2656543 L151.357547,77.7411507 L186.65952,121.347877 L249.770673,136.689364 C263.390071,111.405536 253.93411,79.8683506 228.650281,66.2489531 C222.117076,62.7297161 214.906119,60.6497377 207.502301,60.1484453 L207.502301,60.1481967 L207.502052,60.1481967 Z" />
    <path fill="#28A8EA" d="M11.4981977,136.595916 C23.4514253,153.781772 43.063467,164.023845 63.9974594,164.012918 L203.991762,164.012918 C223.115435,164.018377 240.697951,153.524291 249.770425,136.689862 L151.357298,77.7409022 L11.4981977,136.595916 Z" />
  </svg>
);

export const DropboxIcon = (props: IconProps) => (
  <svg viewBox="0 0 256 218" preserveAspectRatio="xMidYMid" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
    <g fill="#0061FF">
      <polygon points="63.9945638 0 0 40.7712563 63.9945638 81.5425125 128 40.7712563" />
      <polygon points="192.000442 0 128 40.7750015 192.000442 81.5500031 256.000885 40.7750015" />
      <polygon points="0 122.321259 63.9945638 163.092516 128 122.321259 63.9945638 81.5500031" />
      <polygon points="192 81.5500031 128 122.324723 192 163.099442 256 122.324723" />
      <polygon points="64 176.771256 128.005436 217.542513 192 176.771256 128.005436 136" />
    </g>
  </svg>
);
