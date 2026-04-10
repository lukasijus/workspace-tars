const fs = require("fs");

function loadApplicantFacts(factsPath) {
  const defaults = {
    version: 1,
    location: {
      basedInEuropeOrIsrael: false,
      canWorkCetHours: false,
    },
    authorization: {
      authorizedToWork: true,
      needVisaSponsorship: false,
      requireVisaSponsorship: false,
    },
    experience: {
      reactTypescriptComplexApps: false,
      agenticCodingTools: false,
      skills: {},
    },
    preferences: {
      allowFutureRoles: true,
      readPrivacyNotice: true,
      personalDataConsent: true,
      consentToBackgroundCheck: true,
      willingToRelocate: true,
    },
    links: {
      personalWebsite: "",
      portfolioUrl: "",
    },
  };

  if (!factsPath || !fs.existsSync(factsPath)) {
    return defaults;
  }

  const payload = JSON.parse(fs.readFileSync(factsPath, "utf8"));
  return {
    version: payload.version || defaults.version,
    location: {
      ...defaults.location,
      ...(payload.location || {}),
    },
    authorization: {
      ...defaults.authorization,
      ...(payload.authorization || {}),
    },
    experience: {
      ...defaults.experience,
      ...(payload.experience || {}),
      skills: {
        ...defaults.experience.skills,
        ...((payload.experience && payload.experience.skills) || {}),
      },
    },
    preferences: {
      ...defaults.preferences,
      ...(payload.preferences || {}),
    },
    links: {
      ...defaults.links,
      ...(payload.links || {}),
    },
  };
}

module.exports = {
  loadApplicantFacts,
};
