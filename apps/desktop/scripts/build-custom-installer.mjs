import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(desktopRoot, 'package.json'), 'utf-8'));
const version = pkg.version || '0.14.2';

const outDirArg = process.argv[2] || 'release/v14_2';
const releaseDir = resolve(desktopRoot, outDirArg);
const unpackedDir = resolve(releaseDir, 'win-unpacked');
const workDir = resolve(releaseDir, '_custom_installer_work');
const payloadZip = resolve(workDir, 'payload.zip');
const csPath = resolve(workDir, 'PMusicInstaller.cs');
const outExe = resolve(releaseDir, `pMusic-Setup-${version}.exe`);
const iconIco = resolve(desktopRoot, 'build/icon.ico');
const iconPng = resolve(desktopRoot, 'build/icon.png');

if (!existsSync(unpackedDir)) {
  throw new Error(`Missing unpacked Electron directory: ${unpackedDir}`);
}
mkdirSync(workDir, { recursive: true });

// 1. Compress win-unpacked into payload.zip using PowerShell .NET ZipFile (fast, native)
if (existsSync(payloadZip)) rmSync(payloadZip, { force: true });
console.log('Packing pMusic payload.zip...');
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${unpackedDir.replace(/'/g, "''")}', '${payloadZip.replace(/'/g, "''")}', [System.IO.Compression.CompressionLevel]::Fastest, $false)`,
  ],
  { stdio: 'inherit' }
);

// 2. Generate 100% custom frameless futuristic dark Windows installer (C# / WinForms + GDI+)
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
  public class FuturisticInstallerForm : Form {
    private const string APP_VERSION = "${version}";
    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HT_CAPTION = 0x2;

    [DllImport("user32.dll")]
    private static extern int SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);
    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    private Image logoImg;
    private TextBox pathBox;
    private CheckBox desktopCheck;
    private Button installBtn;
    private Button browseBtn;
    private Label statusLabel;
    private Panel progressTrack;
    private float progressValue = 0f;
    private bool installing = false;
    private bool installed = false;
    private string installedExePath = "";

    public FuturisticInstallerForm() {
      this.FormBorderStyle = FormBorderStyle.None;
      this.StartPosition = FormStartPosition.CenterScreen;
      this.ClientSize = new Size(680, 440);
      this.BackColor = Color.FromArgb(6, 6, 10);
      this.DoubleBuffered = true;
      this.Text = "Instalador de pMusic " + APP_VERSION;

      try {
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("pMusic.icon.png")) {
          if (s != null) logoImg = Image.FromStream(s);
        }
      } catch {}

      try {
        this.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
      } catch {}

      this.Region = CreateRoundedRegion(this.ClientSize.Width, this.ClientSize.Height, 24);
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

    private void BuildUi() {
      // Custom top-right window controls
      Button minBtn = new Button {
        Text = "—",
        ForeColor = Color.FromArgb(180, 180, 195),
        BackColor = Color.FromArgb(18, 18, 26),
        FlatStyle = FlatStyle.Flat,
        Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
        Size = new Size(34, 34),
        Location = new Point(this.ClientSize.Width - 88, 18),
        Cursor = Cursors.Hand,
        TabStop = false
      };
      minBtn.FlatAppearance.BorderColor = Color.FromArgb(42, 42, 56);
      minBtn.FlatAppearance.BorderSize = 1;
      minBtn.Click += (s, e) => this.WindowState = FormWindowState.Minimized;
      this.Controls.Add(minBtn);

      Button closeBtn = new Button {
        Text = "✕",
        ForeColor = Color.FromArgb(220, 220, 232),
        BackColor = Color.FromArgb(18, 18, 26),
        FlatStyle = FlatStyle.Flat,
        Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
        Size = new Size(34, 34),
        Location = new Point(this.ClientSize.Width - 46, 18),
        Cursor = Cursors.Hand,
        TabStop = false
      };
      closeBtn.FlatAppearance.BorderColor = Color.FromArgb(42, 42, 56);
      closeBtn.FlatAppearance.BorderSize = 1;
      closeBtn.Click += (s, e) => { if (!installing) this.Close(); };
      this.Controls.Add(closeBtn);

      string defaultDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Programs",
        "pmusic"
      );

      Label dirCaption = new Label {
        Text = "CARPETA DE INSTALACIÓN",
        ForeColor = Color.FromArgb(135, 138, 156),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI Semibold", 8.2f, FontStyle.Bold),
        Location = new Point(44, 212),
        AutoSize = true
      };
      this.Controls.Add(dirCaption);

      pathBox = new TextBox {
        Text = defaultDir,
        ForeColor = Color.White,
        BackColor = Color.FromArgb(16, 17, 24),
        BorderStyle = BorderStyle.FixedSingle,
        Font = new Font("Segoe UI", 10f),
        Location = new Point(44, 234),
        Size = new Size(478, 30)
      };
      this.Controls.Add(pathBox);

      browseBtn = new Button {
        Text = "Cambiar...",
        ForeColor = Color.FromArgb(225, 225, 238),
        BackColor = Color.FromArgb(24, 25, 36),
        FlatStyle = FlatStyle.Flat,
        Font = new Font("Segoe UI Semibold", 9.2f),
        Location = new Point(530, 233),
        Size = new Size(106, 30),
        Cursor = Cursors.Hand
      };
      browseBtn.FlatAppearance.BorderColor = Color.FromArgb(52, 54, 72);
      browseBtn.FlatAppearance.BorderSize = 1;
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
        ForeColor = Color.FromArgb(200, 202, 216),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI", 9.5f),
        Location = new Point(44, 276),
        AutoSize = true,
        Cursor = Cursors.Hand
      };
      this.Controls.Add(desktopCheck);

      progressTrack = new Panel {
        Location = new Point(44, 320),
        Size = new Size(592, 8),
        BackColor = Color.FromArgb(24, 25, 34)
      };
      progressTrack.Paint += (s, e) => {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        int fillW = (int)(progressTrack.Width * Math.Max(0f, Math.Min(1f, progressValue)));
        if (fillW > 2) {
          using (LinearGradientBrush br = new LinearGradientBrush(
            new Rectangle(0, 0, Math.Max(4, fillW), progressTrack.Height),
            Color.FromArgb(250, 35, 59),
            Color.White,
            LinearGradientMode.Horizontal)) {
            e.Graphics.FillRectangle(br, 0, 0, fillW, progressTrack.Height);
          }
        }
      };
      this.Controls.Add(progressTrack);

      statusLabel = new Label {
        Text = "Listo para instalar pMusic " + APP_VERSION + " en tu PC.",
        ForeColor = Color.FromArgb(156, 160, 178),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI", 9.2f),
        Location = new Point(44, 336),
        Size = new Size(390, 24)
      };
      this.Controls.Add(statusLabel);

      installBtn = new Button {
        Text = "Instalar pMusic",
        ForeColor = Color.FromArgb(10, 10, 14),
        BackColor = Color.White,
        FlatStyle = FlatStyle.Flat,
        Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
        Location = new Point(452, 366),
        Size = new Size(184, 44),
        Cursor = Cursors.Hand
      };
      installBtn.FlatAppearance.BorderSize = 0;
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

      // Subtle dark gradient canvas
      using (LinearGradientBrush bg = new LinearGradientBrush(
        this.ClientRectangle,
        Color.FromArgb(7, 7, 12),
        Color.FromArgb(4, 4, 7),
        LinearGradientMode.ForwardDiagonal)) {
        g.FillRectangle(bg, this.ClientRectangle);
      }

      // Subtle architectural grid
      using (Pen gridPen = new Pen(Color.FromArgb(12, 255, 255, 255), 1)) {
        for (int x = 0; x < this.ClientSize.Width; x += 44) g.DrawLine(gridPen, x, 0, x, this.ClientSize.Height);
        for (int y = 0; y < this.ClientSize.Height; y += 44) g.DrawLine(gridPen, 0, y, this.ClientSize.Width, y);
      }

      // Top radial crimson-slate glow
      using (GraphicsPath gp = new GraphicsPath()) {
        gp.AddEllipse(140, -140, 420, 300);
        using (PathGradientBrush glow = new PathGradientBrush(gp)) {
          glow.CenterColor = Color.FromArgb(58, 250, 35, 59);
          glow.SurroundColors = new Color[] { Color.Transparent };
          g.FillPath(glow, gp);
        }
      }

      // Hairline rounded border
      using (Pen borderPen = new Pen(Color.FromArgb(46, 255, 255, 255), 1.5f)) {
        g.DrawRectangle(borderPen, 1, 1, this.ClientSize.Width - 3, this.ClientSize.Height - 3);
      }

      // Brand header: centered icon + typography
      if (logoImg != null) {
        g.DrawImage(logoImg, 44, 44, 78, 78);
      }

      using (Font badgeFont = new Font("Segoe UI Semibold", 8.5f, FontStyle.Bold))
      using (Brush accentBrush = new SolidBrush(Color.FromArgb(255, 96, 118))) {
        g.DrawString("INSTALADOR OFICIAL  ·  WINDOWS x64", badgeFont, accentBrush, 140, 48);
      }

      using (Font titleFont = new Font("Segoe UI", 26f, FontStyle.Bold))
      using (Brush whiteBrush = new SolidBrush(Color.White)) {
        g.DrawString("pMusic", titleFont, whiteBrush, 136, 66);
      }

      using (Font subFont = new Font("Segoe UI", 10.5f))
      using (Brush mutedBrush = new SolidBrush(Color.FromArgb(170, 174, 192))) {
        g.DrawString("Audio Hi-Fi, Connect PC ↔ Móvil y Wrapped · v" + APP_VERSION, subFont, mutedBrush, 140, 114);
      }

      // Divider line
      using (Pen sep = new Pen(Color.FromArgb(26, 255, 255, 255), 1)) {
        g.DrawLine(sep, 44, 174, this.ClientSize.Width - 44, 174);
      }
    }

    private void SetProgress(float p, string text) {
      if (this.InvokeRequired) {
        this.BeginInvoke(new Action(() => SetProgress(p, text)));
        return;
      }
      progressValue = p;
      statusLabel.Text = text;
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
          SetProgress(0.05f, "Preparando carpeta de instalación...");
          Directory.CreateDirectory(targetDir);

          // Close any existing pmusic.exe cleanly only inside targetDir before overwriting
          try {
            foreach (Process proc in Process.GetProcessesByName("pmusic")) {
              try { proc.Kill(); proc.WaitForExit(3000); } catch {}
            }
          } catch {}

          using (Stream resStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("pMusic.payload.zip")) {
            if (resStream == null) throw new Exception("No se encontró el paquete interno de pMusic.");
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
                  float ratio = 0.08f + 0.80f * ((float)done / total);
                  SetProgress(ratio, string.Format("Extrayendo archivos ({0}%)...", (int)(ratio * 100)));
                }
              }
            }
          }

          string exePath = Path.Combine(targetDir, "pmusic.exe");
          installedExePath = exePath;

          SetProgress(0.92f, "Registrando protocolo pmusic:// y accesos directos...");
          RegisterProtocol(exePath);
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
          SetProgress(1.0f, "¡pMusic " + APP_VERSION + " instalado correctamente!");
        });

        installed = true;
        installBtn.Text = "Abrir pMusic";
        installBtn.BackColor = Color.FromArgb(52, 211, 153);
        installBtn.ForeColor = Color.FromArgb(6, 20, 14);
        installBtn.Enabled = true;
      } catch (Exception ex) {
        SetProgress(0f, "Error: " + ex.Message);
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
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\pmusic")) {
          if (key != null) {
            key.SetValue("", "URL:pMusic Protocol");
            key.SetValue("URL Protocol", "");
            using (RegistryKey cmd = key.CreateSubKey(@"shell\open\command")) {
              if (cmd != null) cmd.SetValue("", "\\"" + exePath + "\\" \\"%1\\"");
            }
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
        shortcut.Description = "pMusic — Reproductor de música Hi-Fi";
        shortcut.Save();
      } catch {}
    }

    [STAThread]
    public static void Main() {
      Application.EnableVisualStyles();
      Application.SetCompatibleTextRenderingDefault(false);
      Application.Run(new FuturisticInstallerForm());
    }
  }
}
`;

writeFileSync(csPath, csSource, 'utf-8');

const cscPath = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
console.log('Compiling custom futuristic pMusic installer...');
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
