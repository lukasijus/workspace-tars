import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    background: {
      default: "#eef2f5",
      paper: "#ffffff",
    },
    primary: {
      main: "#2457c5",
    },
    secondary: {
      main: "#0f766e",
    },
    success: {
      main: "#138a4b",
    },
    warning: {
      main: "#b7791f",
    },
    error: {
      main: "#c43b3b",
    },
  },
  typography: {
    fontFamily: `"Space Grotesk", "Aptos", "Segoe UI", sans-serif`,
    h1: {
      fontWeight: 800,
      letterSpacing: "-0.045em",
    },
    h2: {
      fontWeight: 760,
      letterSpacing: "-0.035em",
    },
    h3: {
      fontWeight: 720,
      letterSpacing: "-0.025em",
    },
    button: {
      fontWeight: 700,
      textTransform: "none",
    },
  },
  shape: {
    borderRadius: 16,
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 800,
          color: "#536176",
          background: "#f7f9fc",
        },
      },
    },
  },
});
