import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(desktopRoot, 'package.json'), 'utf-8'));
const version = pkg.version || '0.20.0';

const outDirArg = process.argv[2] || 'release';
const releaseDir = resolve(desktopRoot, outDirArg);
const unpackedDir = resolve(releaseDir, 'win-unpacked');
const workDir = resolve(releaseDir, '_custom_installer_work');
const stagedDir = resolve(workDir, 'staged-app');
const payloadZip = resolve(workDir, 'payload.zip');
const csPath = resolve(workDir, 'PMusicInstaller.cs');
const outExe = resolve(releaseDir, 'pMusic-Setup.exe');
const iconIco = resolve(desktopRoot, 'build/icon.ico');
const iconPng = resolve(desktopRoot, 'build/icon.png');

if (!existsSync(unpackedDir)) {
  throw new Error(`Missing unpacked Electron directory: ${unpackedDir}`);
}
mkdirSync(workDir, { recursive: true });
if (existsSync(stagedDir)) rmSync(stagedDir, { recursive: true, force: true });
if (existsSync(payloadZip)) rmSync(payloadZip, { force: true });

console.log('Staging & pruning unused locales to compress installer...');
cpSync(unpackedDir, stagedDir, { recursive: true });

const keepLocales = new Set(['es.pak', 'es-419.pak', 'en-US.pak', 'en-GB.pak']);
const localesDir = resolve(stagedDir, 'locales');
if (existsSync(localesDir)) {
  for (const file of readdirSync(localesDir)) {
    if (!keepLocales.has(file)) {
      rmSync(resolve(localesDir, file), { force: true });
    }
  }
}
for (const bloatFile of ['LICENSES.chromium.html', 'LICENSE.electron.txt']) {
  const full = resolve(stagedDir, bloatFile);
  if (existsSync(full)) rmSync(full, { force: true });
}

console.log('Compressing pMusic payload.zip (CompressionLevel::Optimal)...');
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${stagedDir.replace(/'/g, "''")}', '${payloadZip.replace(/'/g, "''")}', [System.IO.Compression.CompressionLevel]::Optimal, $false)`,
  ],
  { stdio: 'inherit' }
);
rmSync(stagedDir, { recursive: true, force: true });
console.log(`Compressed payload.zip: ${(statSync(payloadZip).size / (1024 * 1024)).toFixed(2)} MB`);

const csSource = `using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace PMusicSetup {
  public class ModernPMusicInstaller : Form {
    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HT_CAPTION = 0x2;

    [DllImport("user32.dll")]
    private static extern int SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);
    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    private Image logoImg;
    private TextBox pathBox;
    private Panel pathShell;
    private CheckBox desktopCheck;
    private Button installBtn;
    private Button browseBtn;
    private Label statusLabel;
    private Label pctLabel;
    private Panel progressTrack;
    private float progressValue = 0f;
    private bool installing = false;
    private bool installed = false;
    private string installedExePath = "";

    public ModernPMusicInstaller() {
      this.FormBorderStyle = FormBorderStyle.None;
      this.StartPosition = FormStartPosition.CenterScreen;
      this.ClientSize = new Size(560, 434);
      this.BackColor = Color.FromArgb(7, 7, 11);
      this.DoubleBuffered = true;
      this.Text = "pMusic";

      try {
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("pMusic.icon.png")) {
          if (s != null) logoImg = Image.FromStream(s);
        }
      } catch {}

      try {
        this.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
      } catch {}

      this.Region = CreateRoundedRegion(this.ClientSize.Width, this.ClientSize.Height, 28);
      this.MouseDown += (s, e) => {
        if (e.Button == MouseButtons.Left) {
          ReleaseCapture();
          SendMessage(this.Handle, WM_NCLBUTTONDOWN, HT_CAPTION, 0);
        }
      };

      BuildUi();
    }

    private static Region CreateRoundedRegion(int w, int h, int r) {
      GraphicsPath path = new GraphicsPath();
      int d = r * 2;
      path.AddArc(0, 0, d, d, 180, 90);
      path.AddArc(w - d, 0, d, d, 270, 90);
      path.AddArc(w - d, h - d, d, d, 0, 90);
      path.AddArc(0, h - d, d, d, 90, 90);
      path.CloseFigure();
      return new Region(path);
    }

    private static GraphicsPath CreateRoundedRectPath(Rectangle bounds, int r) {
      GraphicsPath path = new GraphicsPath();
      int d = r * 2;
      path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
      path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
      path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
      path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
      path.CloseFigure();
      return path;
    }

    private void BuildUi() {
      Button closeBtn = new Button {
        Text = "✕",
        ForeColor = Color.FromArgb(190, 192, 208),
        BackColor = Color.FromArgb(20, 20, 29),
        FlatStyle = FlatStyle.Flat,
        Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
        Size = new Size(34, 34),
        Location = new Point(this.ClientSize.Width - 52, 18),
        Cursor = Cursors.Hand,
        TabStop = false
      };
      closeBtn.FlatAppearance.BorderSize = 0;
      closeBtn.FlatAppearance.MouseOverBackColor = Color.FromArgb(38, 38, 52);
      closeBtn.Region = CreateRoundedRegion(34, 34, 17);
      closeBtn.Click += (s, e) => { if (!installing) this.Close(); };
      this.Controls.Add(closeBtn);

      Label subtitleLabel = new Label {
        Text = "Tu música, sin límites.",
        ForeColor = Color.FromArgb(172, 174, 194),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI", 10.2f, FontStyle.Regular),
        TextAlign = ContentAlignment.MiddleCenter,
        Location = new Point(40, 168),
        Size = new Size(this.ClientSize.Width - 80, 22)
      };
      this.Controls.Add(subtitleLabel);

      Label featureLine = new Label {
        Text = "Hi-Fi · Letras Sing · Jam & Amigos en tiempo real",
        ForeColor = Color.FromArgb(128, 130, 152),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI", 8.6f, FontStyle.Bold),
        TextAlign = ContentAlignment.MiddleCenter,
        Location = new Point(40, 193),
        Size = new Size(this.ClientSize.Width - 80, 18)
      };
      this.Controls.Add(featureLine);

      string defaultDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Programs",
        "pmusic"
      );

      Label folderLbl = new Label {
        Text = "CARPETA DE INSTALACIÓN",
        ForeColor = Color.FromArgb(132, 134, 156),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI", 7.8f, FontStyle.Bold),
        Location = new Point(44, 232),
        AutoSize = true
      };
      this.Controls.Add(folderLbl);

      pathShell = new Panel {
        Location = new Point(44, 252),
        Size = new Size(392, 36),
        BackColor = Color.FromArgb(16, 16, 24)
      };
      pathShell.Region = CreateRoundedRegion(392, 36, 12);
      pathShell.Paint += (s, e) => {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (GraphicsPath gp = CreateRoundedRectPath(new Rectangle(0, 0, pathShell.Width - 1, pathShell.Height - 1), 12))
        using (Pen p = new Pen(Color.FromArgb(36, 255, 255, 255), 1f)) {
          e.Graphics.DrawPath(p, gp);
        }
      };

      pathBox = new TextBox {
        Text = defaultDir,
        ForeColor = Color.FromArgb(236, 236, 246),
        BackColor = Color.FromArgb(16, 16, 24),
        BorderStyle = BorderStyle.None,
        Font = new Font("Segoe UI", 9.6f),
        Location = new Point(12, 9),
        Size = new Size(368, 20)
      };
      pathShell.Controls.Add(pathBox);
      this.Controls.Add(pathShell);

      browseBtn = new Button {
        Text = "Elegir",
        ForeColor = Color.FromArgb(228, 228, 242),
        BackColor = Color.FromArgb(26, 26, 38),
        FlatStyle = FlatStyle.Flat,
        Font = new Font("Segoe UI", 8.8f, FontStyle.Bold),
        Location = new Point(444, 252),
        Size = new Size(72, 36),
        Cursor = Cursors.Hand
      };
      browseBtn.FlatAppearance.BorderSize = 0;
      browseBtn.FlatAppearance.MouseOverBackColor = Color.FromArgb(42, 42, 60);
      browseBtn.Region = CreateRoundedRegion(72, 36, 12);
      browseBtn.Click += (s, e) => {
        using (FolderBrowserDialog fbd = new FolderBrowserDialog()) {
          fbd.SelectedPath = pathBox.Text;
          if (fbd.ShowDialog() == DialogResult.OK && !string.IsNullOrWhiteSpace(fbd.SelectedPath)) {
            pathBox.Text = fbd.SelectedPath;
          }
        }
      };
      this.Controls.Add(browseBtn);

      desktopCheck = new CheckBox {
        Text = "Crear acceso directo en el Escritorio",
        Checked = true,
        ForeColor = Color.FromArgb(182, 184, 204),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI", 9.2f),
        Location = new Point(44, 298),
        AutoSize = true,
        Cursor = Cursors.Hand
      };
      this.Controls.Add(desktopCheck);

      progressTrack = new Panel {
        Location = new Point(44, 336),
        Size = new Size(472, 8),
        BackColor = Color.FromArgb(24, 24, 34)
      };
      progressTrack.Region = CreateRoundedRegion(472, 8, 4);
      progressTrack.Paint += (s, e) => {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        int fillW = (int)(progressTrack.Width * Math.Max(0f, Math.Min(1f, progressValue)));
        if (fillW > 0) {
          using (LinearGradientBrush br = new LinearGradientBrush(
            new Rectangle(0, 0, Math.Max(2, fillW), progressTrack.Height),
            Color.FromArgb(250, 35, 59),
            Color.FromArgb(191, 90, 242),
            0f
          )) {
            e.Graphics.FillRectangle(br, 0, 0, fillW, progressTrack.Height);
          }
        }
      };
      this.Controls.Add(progressTrack);

      statusLabel = new Label {
        Text = "Listo para instalar pMusic en este equipo",
        ForeColor = Color.FromArgb(154, 156, 176),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI", 8.8f),
        Location = new Point(44, 354),
        Size = new Size(218, 22)
      };
      this.Controls.Add(statusLabel);

      pctLabel = new Label {
        Text = "",
        ForeColor = Color.FromArgb(236, 236, 248),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI", 9f, FontStyle.Bold),
        TextAlign = ContentAlignment.MiddleRight,
        Location = new Point(256, 354),
        Size = new Size(58, 22)
      };
      this.Controls.Add(pctLabel);

      installBtn = new Button {
        Text = "Instalar pMusic",
        ForeColor = Color.FromArgb(8, 8, 12),
        BackColor = Color.White,
        FlatStyle = FlatStyle.Flat,
        Font = new Font("Segoe UI", 10.4f, FontStyle.Bold),
        Location = new Point(328, 362),
        Size = new Size(188, 46),
        Cursor = Cursors.Hand
      };
      installBtn.FlatAppearance.BorderSize = 0;
      installBtn.FlatAppearance.MouseOverBackColor = Color.FromArgb(234, 234, 244);
      installBtn.Region = CreateRoundedRegion(188, 46, 23);
      installBtn.Click += async (s, e) => {
        if (installed) {
          try {
            if (File.Exists(installedExePath)) {
              Process.Start(new ProcessStartInfo(installedExePath) { UseShellExecute = true });
            }
          } catch {}
          this.Close();
          return;
        }
        await RunInstallationAsync();
      };
      this.Controls.Add(installBtn);
    }

    protected override void OnPaint(PaintEventArgs e) {
      base.OnPaint(e);
      Graphics g = e.Graphics;
      g.SmoothingMode = SmoothingMode.AntiAlias;
      g.InterpolationMode = InterpolationMode.HighQualityBicubic;

      g.Clear(Color.FromArgb(7, 7, 11));

      // Subtle pMusic crimson/violet ambient studio halo
      using (GraphicsPath gp = new GraphicsPath()) {
        gp.AddEllipse(70, -135, 420, 300);
        using (PathGradientBrush glow = new PathGradientBrush(gp)) {
          glow.CenterColor = Color.FromArgb(52, 191, 90, 242);
          glow.SurroundColors = new Color[] { Color.Transparent };
          g.FillPath(glow, gp);
        }
      }
      using (GraphicsPath gp2 = new GraphicsPath()) {
        gp2.AddEllipse(190, -110, 260, 220);
        using (PathGradientBrush glow2 = new PathGradientBrush(gp2)) {
          glow2.CenterColor = Color.FromArgb(40, 250, 35, 59);
          glow2.SurroundColors = new Color[] { Color.Transparent };
          g.FillPath(glow2, gp2);
        }
      }

      // Soft inner card surface behind controls
      Rectangle cardRect = new Rectangle(28, 220, this.ClientSize.Width - 56, 134);
      using (GraphicsPath cardPath = CreateRoundedRectPath(cardRect, 18))
      using (SolidBrush cardFill = new SolidBrush(Color.FromArgb(18, 255, 255, 255)))
      using (Pen cardStroke = new Pen(Color.FromArgb(22, 255, 255, 255), 1f)) {
        g.FillPath(cardFill, cardPath);
        g.DrawPath(cardStroke, cardPath);
      }

      // Outer rounded hairline glass frame
      using (GraphicsPath borderPath = CreateRoundedRectPath(new Rectangle(1, 1, this.ClientSize.Width - 2, this.ClientSize.Height - 2), 27))
      using (Pen borderPen = new Pen(Color.FromArgb(44, 255, 255, 255), 1.4f)) {
        g.DrawPath(borderPen, borderPath);
      }

      // Centered pMusic squircle icon
      if (logoImg != null) {
        g.DrawImage(logoImg, (this.ClientSize.Width - 82) / 2, 34, 82, 82);
      }

      // Clean "pMusic" wordmark without version clutter
      using (Font titleFont = new Font("Segoe UI", 23f, FontStyle.Bold))
      using (Brush whiteBrush = new SolidBrush(Color.White))
      using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center }) {
        g.DrawString("pMusic", titleFont, whiteBrush, this.ClientSize.Width / 2f, 124, sf);
      }
    }

    private void SetProgress(float p, string status, string pctText) {
      if (this.InvokeRequired) {
        this.BeginInvoke(new Action(() => SetProgress(p, status, pctText)));
        return;
      }
      progressValue = p;
      statusLabel.Text = status;
      pctLabel.Text = pctText;
      progressTrack.Invalidate();
    }

    private async Task RunInstallationAsync() {
      string targetDir = pathBox.Text.Trim();
      if (string.IsNullOrEmpty(targetDir)) return;

      installing = true;
      installBtn.Enabled = false;
      browseBtn.Enabled = false;
      pathBox.Enabled = false;
      desktopCheck.Enabled = false;
      installBtn.Text = "Instalando...";

      try {
        await Task.Run(() => {
          SetProgress(0.05f, "Preparando archivos...", "5%");
          Directory.CreateDirectory(targetDir);

          try {
            foreach (Process proc in Process.GetProcessesByName("pmusic")) {
              try { proc.Kill(); proc.WaitForExit(3000); } catch {}
            }
          } catch {}

          using (Stream resStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("pMusic.payload.zip")) {
            if (resStream == null) throw new Exception("Paquete interno no encontrado.");
            using (ZipArchive archive = new ZipArchive(resStream, ZipArchiveMode.Read)) {
              int total = Math.Max(1, archive.Entries.Count);
              int done = 0;
              foreach (ZipArchiveEntry entry in archive.Entries) {
                string destPath = Path.GetFullPath(Path.Combine(targetDir, entry.FullName));
                if (!destPath.StartsWith(Path.GetFullPath(targetDir), StringComparison.OrdinalIgnoreCase)) continue;
                if (string.IsNullOrEmpty(entry.Name)) {
                  Directory.CreateDirectory(destPath);
                } else {
                  Directory.CreateDirectory(Path.GetDirectoryName(destPath));
                  entry.ExtractToFile(destPath, true);
                }
                done++;
                if (done % 6 == 0 || done == total) {
                  float ratio = 0.08f + 0.84f * ((float)done / total);
                  SetProgress(ratio, "Instalando pMusic...", string.Format("{0}%", (int)(ratio * 100)));
                }
              }
            }
          }

          string exePath = Path.Combine(targetDir, "pmusic.exe");
          installedExePath = exePath;

          SetProgress(0.95f, "Configurando accesos directos...", "95%");
          RegisterProtocol(exePath);
          RegisterUninstallEntry(targetDir, exePath);
          CreateShortcut(
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "pMusic.lnk"),
            exePath,
            targetDir
          );
          if (desktopCheck.Checked) {
            CreateShortcut(
              Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "pMusic.lnk"),
              exePath,
              targetDir
            );
          }
          SetProgress(1.0f, "¡Listo! pMusic instalado", "100%");
        });

        installed = true;
        installBtn.Text = "Abrir pMusic";
        installBtn.BackColor = Color.FromArgb(245, 255, 248);
        installBtn.Enabled = true;
      } catch (Exception ex) {
        SetProgress(0f, ex.Message, "Error");
        installBtn.Text = "Reintentar";
        installBtn.Enabled = true;
        browseBtn.Enabled = true;
        pathBox.Enabled = true;
        desktopCheck.Enabled = true;
      } finally {
        installing = false;
      }
    }

    private static void RegisterProtocol(string exePath) {
      try {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\\Classes\\pmusic")) {
          if (key != null) {
            key.SetValue("", "URL:pMusic Protocol");
            key.SetValue("URL Protocol", "");
            using (RegistryKey cmd = key.CreateSubKey(@"shell\\open\\command")) {
              if (cmd != null) cmd.SetValue("", "\\"" + exePath + "\\" \\"%1\\"");
            }
          }
        }
      } catch {}
    }

    private static void RegisterUninstallEntry(string targetDir, string exePath) {
      try {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\pMusic")) {
          if (key != null) {
            key.SetValue("DisplayName", "pMusic");
            key.SetValue("DisplayIcon", exePath + ",0");
            key.SetValue("InstallLocation", targetDir);
            key.SetValue("Publisher", "pMusic");
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
          }
        }
      } catch {}
    }

    private static void CreateShortcut(string shortcutPath, string targetExe, string workingDir) {
      try {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) return;
        dynamic shell = Activator.CreateInstance(shellType);
        dynamic shortcut = shell.CreateShortcut(shortcutPath);
        shortcut.TargetPath = targetExe;
        shortcut.WorkingDirectory = workingDir;
        shortcut.IconLocation = targetExe + ",0";
        shortcut.Description = "pMusic";
        shortcut.Save();
      } catch {}
    }

    public static int RunSilentUpdate(string targetDir, bool relaunch) {
      try {
        if (string.IsNullOrEmpty(targetDir)) {
          targetDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "pMusic");
        }
        Directory.CreateDirectory(targetDir);
        try {
          foreach (Process proc in Process.GetProcessesByName("pmusic")) {
            try { proc.WaitForExit(4500); } catch {}
            if (!proc.HasExited) {
              try { proc.Kill(); proc.WaitForExit(2500); } catch {}
            }
          }
        } catch {}

        using (Stream resStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("pMusic.payload.zip")) {
          if (resStream == null) return 2;
          using (ZipArchive archive = new ZipArchive(resStream, ZipArchiveMode.Read)) {
            foreach (ZipArchiveEntry entry in archive.Entries) {
              string destPath = Path.GetFullPath(Path.Combine(targetDir, entry.FullName));
              if (!destPath.StartsWith(Path.GetFullPath(targetDir), StringComparison.OrdinalIgnoreCase)) continue;
              if (string.IsNullOrEmpty(entry.Name)) {
                Directory.CreateDirectory(destPath);
              } else {
                Directory.CreateDirectory(Path.GetDirectoryName(destPath));
                for (int retry = 0; retry < 5; retry++) {
                  try {
                    entry.ExtractToFile(destPath, true);
                    break;
                  } catch {
                    System.Threading.Thread.Sleep(300);
                  }
                }
              }
            }
          }
        }

        string exePath = Path.Combine(targetDir, "pmusic.exe");
        RegisterProtocol(exePath);
        RegisterUninstallEntry(targetDir, exePath);
        if (relaunch && File.Exists(exePath)) {
          Process.Start(new ProcessStartInfo(exePath) { WorkingDirectory = targetDir });
        }
        return 0;
      } catch {
        return 1;
      }
    }

    [STAThread]
    public static int Main(string[] args) {
      bool silent = false;
      bool relaunch = false;
      string customDir = "";
      if (args != null) {
        foreach (string a in args) {
          if (string.Equals(a, "/silent", StringComparison.OrdinalIgnoreCase) || string.Equals(a, "--silent", StringComparison.OrdinalIgnoreCase)) {
            silent = true;
          } else if (string.Equals(a, "/relaunch", StringComparison.OrdinalIgnoreCase) || string.Equals(a, "--relaunch", StringComparison.OrdinalIgnoreCase)) {
            relaunch = true;
          } else if (a != null && (a.StartsWith("/dir=", StringComparison.OrdinalIgnoreCase) || a.StartsWith("--dir=", StringComparison.OrdinalIgnoreCase))) {
            customDir = a.Substring(a.IndexOf('=') + 1).Trim('"');
          }
        }
      }
      if (silent) {
        return RunSilentUpdate(customDir, relaunch);
      }
      Application.EnableVisualStyles();
      Application.SetCompatibleTextRenderingDefault(false);
      Application.Run(new ModernPMusicInstaller());
      return 0;
    }
  }
}
`;

writeFileSync(csPath, csSource, 'utf-8');

const cscPath = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
console.log(`Compiling modern versionless pMusic installer (app ${version})...`);
execFileSync(
  cscPath,
  [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    `/out:${outExe}`,
    `/win32icon:${iconIco}`,
    `/resource:${payloadZip},pMusic.payload.zip`,
    `/resource:${iconPng},pMusic.icon.png`,
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    '/r:System.IO.Compression.dll',
    '/r:System.IO.Compression.FileSystem.dll',
    '/r:Microsoft.CSharp.dll',
    csPath,
  ],
  { stdio: 'inherit' }
);

rmSync(workDir, { recursive: true, force: true });
console.log(`CUSTOM_INSTALLER_READY: ${outExe} (${statSync(outExe).size} bytes)`);
