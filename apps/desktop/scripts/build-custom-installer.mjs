import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(desktopRoot, 'package.json'), 'utf-8'));
const version = pkg.version || '0.14.3';

const outDirArg = process.argv[2] || 'release/v14_3';
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
  public class MinimalPMusicInstaller : Form {
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
    private Label pctLabel;
    private Panel progressTrack;
    private float progressValue = 0f;
    private bool installing = false;
    private bool installed = false;
    private string installedExePath = "";

    public MinimalPMusicInstaller() {
      this.FormBorderStyle = FormBorderStyle.None;
      this.StartPosition = FormStartPosition.CenterScreen;
      this.ClientSize = new Size(520, 360);
      this.BackColor = Color.FromArgb(5, 5, 7);
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

      this.Region = CreateRoundedRegion(this.ClientSize.Width, this.ClientSize.Height, 22);
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
      Button closeBtn = new Button {
        Text = "✕",
        ForeColor = Color.FromArgb(160, 160, 172),
        BackColor = Color.FromArgb(14, 14, 18),
        FlatStyle = FlatStyle.Flat,
        Font = new Font("Segoe UI", 9f, FontStyle.Bold),
        Size = new Size(32, 32),
        Location = new Point(this.ClientSize.Width - 46, 16),
        Cursor = Cursors.Hand,
        TabStop = false
      };
      closeBtn.FlatAppearance.BorderColor = Color.FromArgb(34, 34, 42);
      closeBtn.FlatAppearance.BorderSize = 1;
      closeBtn.Click += (s, e) => { if (!installing) this.Close(); };
      this.Controls.Add(closeBtn);

      string defaultDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Programs",
        "pmusic"
      );

      pathBox = new TextBox {
        Text = defaultDir,
        ForeColor = Color.FromArgb(215, 215, 224),
        BackColor = Color.FromArgb(14, 14, 18),
        BorderStyle = BorderStyle.FixedSingle,
        Font = new Font("Segoe UI", 9.5f),
        Location = new Point(44, 198),
        Size = new Size(382, 28)
      };
      this.Controls.Add(pathBox);

      browseBtn = new Button {
        Text = "...",
        ForeColor = Color.FromArgb(200, 200, 212),
        BackColor = Color.FromArgb(20, 20, 26),
        FlatStyle = FlatStyle.Flat,
        Font = new Font("Segoe UI", 9f, FontStyle.Bold),
        Location = new Point(432, 197),
        Size = new Size(44, 28),
        Cursor = Cursors.Hand
      };
      browseBtn.FlatAppearance.BorderColor = Color.FromArgb(40, 40, 48);
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
        Text = "Acceso directo en Escritorio",
        Checked = true,
        ForeColor = Color.FromArgb(150, 152, 165),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI", 9f),
        Location = new Point(44, 236),
        AutoSize = true,
        Cursor = Cursors.Hand
      };
      this.Controls.Add(desktopCheck);

      progressTrack = new Panel {
        Location = new Point(44, 272),
        Size = new Size(432, 3),
        BackColor = Color.FromArgb(26, 26, 32)
      };
      progressTrack.Paint += (s, e) => {
        int fillW = (int)(progressTrack.Width * Math.Max(0f, Math.Min(1f, progressValue)));
        if (fillW > 0) {
          using (SolidBrush br = new SolidBrush(Color.White)) {
            e.Graphics.FillRectangle(br, 0, 0, fillW, progressTrack.Height);
          }
        }
      };
      this.Controls.Add(progressTrack);

      pctLabel = new Label {
        Text = "",
        ForeColor = Color.FromArgb(130, 132, 145),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI", 8.8f),
        Location = new Point(44, 284),
        Size = new Size(220, 22)
      };
      this.Controls.Add(pctLabel);

      installBtn = new Button {
        Text = "Instalar",
        ForeColor = Color.FromArgb(5, 5, 7),
        BackColor = Color.White,
        FlatStyle = FlatStyle.Flat,
        Font = new Font("Segoe UI", 10f, FontStyle.Bold),
        Location = new Point(316, 294),
        Size = new Size(160, 42),
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

      // Pure obsidian monochrome canvas
      g.Clear(Color.FromArgb(5, 5, 7));

      // Subtle monochrome silver aura (zero red)
      using (GraphicsPath gp = new GraphicsPath()) {
        gp.AddEllipse(100, -110, 320, 260);
        using (PathGradientBrush glow = new PathGradientBrush(gp)) {
          glow.CenterColor = Color.FromArgb(30, 255, 255, 255);
          glow.SurroundColors = new Color[] { Color.Transparent };
          g.FillPath(glow, gp);
        }
      }

      // Hairline border
      using (Pen borderPen = new Pen(Color.FromArgb(32, 255, 255, 255), 1.5f)) {
        g.DrawRectangle(borderPen, 1, 1, this.ClientSize.Width - 3, this.ClientSize.Height - 3);
      }

      // Centered p icon
      if (logoImg != null) {
        g.DrawImage(logoImg, (this.ClientSize.Width - 78) / 2, 42, 78, 78);
      }

      // Minimal centered "pMusic" title
      using (Font titleFont = new Font("Segoe UI", 20f, FontStyle.Bold))
      using (Brush whiteBrush = new SolidBrush(Color.White))
      using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center }) {
        g.DrawString("pMusic", titleFont, whiteBrush, this.ClientSize.Width / 2f, 132, sf);
      }
    }

    private void SetProgress(float p, string text) {
      if (this.InvokeRequired) {
        this.BeginInvoke(new Action(() => SetProgress(p, text)));
        return;
      }
      progressValue = p;
      pctLabel.Text = text;
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
          SetProgress(0.05f, "5%");
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
                  SetProgress(ratio, string.Format("{0}%", (int)(ratio * 100)));
                }
              }
            }
          }

          string exePath = Path.Combine(targetDir, "pmusic.exe");
          installedExePath = exePath;

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
          SetProgress(1.0f, "100%");
        });

        installed = true;
        installBtn.Text = "Abrir pMusic";
        installBtn.Enabled = true;
      } catch (Exception ex) {
        SetProgress(0f, ex.Message);
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
        shortcut.Description = "pMusic";
        shortcut.Save();
      } catch {}
    }

    [STAThread]
    public static void Main() {
      Application.EnableVisualStyles();
      Application.SetCompatibleTextRenderingDefault(false);
      Application.Run(new MinimalPMusicInstaller());
    }
  }
}
`;

writeFileSync(csPath, csSource, 'utf-8');

const cscPath = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
console.log('Compiling minimal pMusic installer...');
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
