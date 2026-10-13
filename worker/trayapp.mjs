// The tray helper as a C# WinForms program, compiled by Windows PowerShell's
// Add-Type each time it starts (a second or two; nothing to install). It is
// the notification-area icon and its menu, the warning card (alerts.mjs says
// when), the settings window, and Start with Windows. tray.mjs starts it and
// carries the lines between it and the worker.
//
// C# 5 only — what .NET Framework's compiler takes: no `=>` members, no
// string interpolation, no `?.`. ASCII only, \u escapes for anything else,
// so the source survives every encoding on its way into PowerShell.
//
// The process is DPI aware at the system's scale (SetProcessDPIAware), so the
// card and the window are sharp on every screen at that scale; a screen at
// another scale gets them stretched by Windows, as before. Everything the
// card shows is drawn by hand at that scale.

export const TRAY_APP_CS = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace FlockTray
{
	static class Native
	{
		[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
		[DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
		[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
		[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);

		/** Windows 11's rounded corners and a border in our colour; false where there are none (Windows 10). */
		public static bool RoundCorners(IntPtr hwnd, Color border)
		{
			try
			{
				int round = 2;
				if (DwmSetWindowAttribute(hwnd, 33, ref round, 4) != 0) return false;
				int colour = border.R | (border.G << 8) | (border.B << 16);
				DwmSetWindowAttribute(hwnd, 34, ref colour, 4);
				return true;
			}
			catch { return false; }
		}

		public static void DarkTitleBar(IntPtr hwnd)
		{
			try
			{
				int on = 1;
				if (DwmSetWindowAttribute(hwnd, 20, ref on, 4) != 0) DwmSetWindowAttribute(hwnd, 19, ref on, 4);
			}
			catch { }
		}
	}

	/** flock's own colours (src/app.css). */
	static class Theme
	{
		public static readonly Color Bg = ColorTranslator.FromHtml("#100e1a");
		public static readonly Color Surface = ColorTranslator.FromHtml("#16131f");
		public static readonly Color Surface2 = ColorTranslator.FromHtml("#1e1a2b");
		public static readonly Color Border = ColorTranslator.FromHtml("#2c2540");
		public static readonly Color BorderStrong = ColorTranslator.FromHtml("#3b3155");
		public static readonly Color Text = ColorTranslator.FromHtml("#ece9f5");
		public static readonly Color Dim = ColorTranslator.FromHtml("#a79fbe");
		public static readonly Color Faint = ColorTranslator.FromHtml("#6f6787");
		public static readonly Color Pink = ColorTranslator.FromHtml("#ff4d9e");
		public static readonly Color Red = ColorTranslator.FromHtml("#ff2828");
		public static readonly Color RedHot = ColorTranslator.FromHtml("#ff4a4a");
		public static readonly Color RedLow = ColorTranslator.FromHtml("#a3191f");

		public static Color Mix(Color a, Color b, double t)
		{
			t = Math.Max(0, Math.Min(1, t));
			return Color.FromArgb(
				(int)(a.R + (b.R - a.R) * t),
				(int)(a.G + (b.G - a.G) * t),
				(int)(a.B + (b.B - a.B) * t));
		}

		public static GraphicsPath Round(RectangleF r, float radius)
		{
			GraphicsPath p = new GraphicsPath();
			float d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
			p.AddArc(r.X, r.Y, d, d, 180, 90);
			p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
			p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
			p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
			p.CloseFigure();
			return p;
		}

		public static float Scale()
		{
			using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) return g.DpiX / 96f;
		}
	}

	/** Mirrors ALERT_DEFAULTS in alerts.mjs, which reads the stored ones. */
	public class AlertSettings
	{
		public bool Enabled = true;
		public string Screen = "second";
		public string Position = "top-right";
		public string Size = "medium";
		public bool Pulse = true;
		public bool Slide = true;
		public bool ShowTitles = true;

		public static AlertSettings From(object raw)
		{
			AlertSettings s = new AlertSettings();
			IDictionary<string, object> d = raw as IDictionary<string, object>;
			if (d == null) return s;
			s.Enabled = Flag(d, "enabled", s.Enabled);
			s.Screen = Word(d, "screen", s.Screen);
			s.Position = Word(d, "position", s.Position);
			s.Size = Word(d, "size", s.Size);
			s.Pulse = Flag(d, "pulse", s.Pulse);
			s.Slide = Flag(d, "slide", s.Slide);
			s.ShowTitles = Flag(d, "showTitles", s.ShowTitles);
			return s;
		}

		static bool Flag(IDictionary<string, object> d, string key, bool fallback)
		{
			object v;
			return d.TryGetValue(key, out v) && v is bool ? (bool)v : fallback;
		}

		static string Word(IDictionary<string, object> d, string key, string fallback)
		{
			object v;
			string s = d.TryGetValue(key, out v) ? v as string : null;
			return string.IsNullOrEmpty(s) ? fallback : s;
		}

		public Dictionary<string, object> ToDict()
		{
			Dictionary<string, object> d = new Dictionary<string, object>();
			d["enabled"] = Enabled;
			d["screen"] = Screen;
			d["position"] = Position;
			d["size"] = Size;
			d["pulse"] = Pulse;
			d["slide"] = Slide;
			d["showTitles"] = ShowTitles;
			return d;
		}

		public AlertSettings Copy() { return (AlertSettings)MemberwiseClone(); }

		/** How much bigger than medium. */
		public float Factor()
		{
			if (Size == "small") return 0.85f;
			if (Size == "large") return 1.3f;
			return 1f;
		}
	}

	public class AlertItem
	{
		public string Key = "";
		public string Platform = "";
		public string Title = "";
		public string Detail = "";
		public string Url = "";

		public static List<AlertItem> ListFrom(object raw)
		{
			List<AlertItem> list = new List<AlertItem>();
			object[] rows = raw as object[];
			if (rows == null) return list;
			foreach (object row in rows)
			{
				IDictionary<string, object> d = row as IDictionary<string, object>;
				if (d == null) continue;
				AlertItem item = new AlertItem();
				item.Key = Get(d, "key");
				item.Platform = Get(d, "platform");
				item.Title = Get(d, "title");
				item.Detail = Get(d, "detail");
				item.Url = Get(d, "url");
				list.Add(item);
			}
			return list;
		}

		static string Get(IDictionary<string, object> d, string key)
		{
			object v;
			return d.TryGetValue(key, out v) && v != null ? v.ToString() : "";
		}
	}

	/** Which screen and where on it, from the settings. */
	public static class Placement
	{
		/**
		 * The second screen: the lowest-numbered one that is not the main one,
		 * by Windows' own numbers (DISPLAY2 before DISPLAY3, as Settings, Display
		 * numbers them), the main one when it is alone.
		 */
		public static Screen Second()
		{
			Screen best = null;
			foreach (Screen s in Screen.AllScreens)
			{
				if (s.Primary) continue;
				if (best == null || Number(s) < Number(best)) best = s;
			}
			return best ?? Screen.PrimaryScreen;
		}

		public static int Number(Screen s)
		{
			string digits = "";
			foreach (char c in s.DeviceName) if (char.IsDigit(c)) digits += c;
			int n;
			return int.TryParse(digits, out n) ? n : int.MaxValue;
		}

		public static Screen Pick(string choice)
		{
			if (choice == "main") return Screen.PrimaryScreen;
			if (choice == "mouse") return Screen.FromPoint(Cursor.Position);
			if (choice != "second")
			{
				foreach (Screen s in Screen.AllScreens)
					if (string.Equals(s.DeviceName, choice, StringComparison.OrdinalIgnoreCase)) return s;
			}
			return Second();
		}

		public static Point At(Rectangle work, Size size, string position, int margin)
		{
			string p = position ?? "top-right";
			int x = p.EndsWith("left") ? work.Left + margin
				: p.EndsWith("right") ? work.Right - size.Width - margin
				: work.Left + (work.Width - size.Width) / 2;
			int y = p.StartsWith("top") ? work.Top + margin
				: p.StartsWith("bottom") ? work.Bottom - size.Height - margin
				: work.Top + (work.Height - size.Height) / 2;
			return new Point(x, y);
		}

		/** "Screen 2 \u00b7 2560\u00d71440 \u00b7 main". */
		/** "Screen 3 \u00b7 1920\u00d71080 \u00b7 above main": its number, its size and where it is, to tell four alike apart. */
		public static string Name(Screen s)
		{
			return Short(s) + " \u00b7 " + s.Bounds.Width + "\u00d7" + s.Bounds.Height + " \u00b7 " + Where(s);
		}

		public static string Short(Screen s)
		{
			int n = Number(s);
			return "Screen " + (n == int.MaxValue ? "?" : n.ToString());
		}

		/** Where a screen sits beside the main one, by its middle: "main", "above main", "right of main", "below, left of main". */
		public static string Where(Screen s)
		{
			if (s.Primary) return "main";
			Rectangle main = Screen.PrimaryScreen.Bounds;
			int cx = s.Bounds.X + s.Bounds.Width / 2;
			int cy = s.Bounds.Y + s.Bounds.Height / 2;
			string across = cx < main.Left ? "left" : cx > main.Right ? "right" : "";
			string up = cy < main.Top ? "above" : cy > main.Bottom ? "below" : "";
			if (across.Length > 0 && up.Length > 0) return up + ", " + across + " of main";
			if (up.Length > 0) return up + " main";
			if (across.Length > 0) return across + " of main";
			return "beside main";
		}
	}

	/**
	 * Identify: each screen's number, large, in its middle for three seconds,
	 * as Windows' own display settings do it, so four alike can be told apart.
	 */
	public class ScreenNumber : Form
	{
		readonly string number;
		readonly string caption;
		readonly Font big;
		readonly Font small;
		readonly System.Windows.Forms.Timer life = new System.Windows.Forms.Timer();

		ScreenNumber(Screen s, float dpi)
		{
			int n = Placement.Number(s);
			number = n == int.MaxValue ? "?" : n.ToString();
			caption = s.Bounds.Width + "\u00d7" + s.Bounds.Height + " \u00b7 " + Placement.Where(s);
			big = new Font("Segoe UI", 150f * dpi, FontStyle.Bold, GraphicsUnit.Pixel);
			small = new Font("Segoe UI", 16f * dpi, FontStyle.Regular, GraphicsUnit.Pixel);
			FormBorderStyle = FormBorderStyle.None;
			ShowInTaskbar = false;
			StartPosition = FormStartPosition.Manual;
			TopMost = true;
			DoubleBuffered = true;
			BackColor = Theme.Bg;
			Size = new Size((int)(260 * dpi), (int)(260 * dpi));
			Location = new Point(s.Bounds.X + (s.Bounds.Width - Width) / 2, s.Bounds.Y + (s.Bounds.Height - Height) / 2);
			life.Interval = 3000;
			life.Tick += delegate { life.Stop(); Close(); };
		}

		protected override bool ShowWithoutActivation { get { return true; } }

		protected override CreateParams CreateParams
		{
			get
			{
				CreateParams cp = base.CreateParams;
				cp.ExStyle |= 0x08000000 | 0x00000080 | 0x00000008;
				return cp;
			}
		}

		protected override void OnHandleCreated(EventArgs e)
		{
			base.OnHandleCreated(e);
			Native.RoundCorners(Handle, Theme.Pink);
		}

		protected override void OnPaint(PaintEventArgs e)
		{
			TextRenderer.DrawText(e.Graphics, number, big, new Rectangle(0, 0, Width, (int)(Height * 0.82f)), Theme.Pink,
				TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
			TextRenderer.DrawText(e.Graphics, caption, small, new Rectangle(0, (int)(Height * 0.74f), Width, (int)(Height * 0.2f)), Theme.Dim,
				TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
		}

		protected override void OnFormClosed(FormClosedEventArgs e)
		{
			big.Dispose();
			small.Dispose();
			base.OnFormClosed(e);
		}

		public static void ShowAll()
		{
			float dpi = Theme.Scale();
			foreach (Screen s in Screen.AllScreens)
			{
				ScreenNumber f = new ScreenNumber(s, dpi);
				f.Show();
				f.life.Start();
			}
		}
	}

	/**
	 * The warning: on top of everything, never taking the keyboard, on the
	 * chosen screen, until Dismiss. Drawn by hand: the red box with the "!"
	 * cut out of it (flock's own mark for a post that did not go out),
	 * what did not go out, and the two buttons.
	 */
	public class Card : Form
	{
		public event EventHandler DismissClicked;
		public event EventHandler OpenClicked;

		List<AlertItem> items = new List<AlertItem>();
		AlertSettings settings = new AlertSettings();
		bool test;
		bool hiding;
		bool rounded;
		readonly float dpi;
		Font titleFont, lineFont, smallFont, buttonFont;
		Rectangle iconBox, dismissBox, openBox, textBox;
		string hover = "";
		readonly System.Windows.Forms.Timer pulseTimer = new System.Windows.Forms.Timer();
		readonly System.Windows.Forms.Timer animTimer = new System.Windows.Forms.Timer();
		readonly DateTime born = DateTime.Now;
		DateTime animStart;
		int animMs;
		bool animIn;
		Point animFrom, animTo;

		public Card()
		{
			dpi = Theme.Scale();
			FormBorderStyle = FormBorderStyle.None;
			ShowInTaskbar = false;
			StartPosition = FormStartPosition.Manual;
			TopMost = true;
			DoubleBuffered = true;
			BackColor = Theme.Bg;
			Text = "flock";
			pulseTimer.Interval = 40;
			pulseTimer.Tick += delegate { Invalidate(); };
			animTimer.Interval = 15;
			animTimer.Tick += AnimTick;
			MouseMove += delegate(object s, MouseEventArgs e) { SetHover(HitTest(e.Location)); };
			MouseLeave += delegate { SetHover(""); };
			MouseClick += OnClickCard;
		}

		public bool IsTest { get { return test; } }

		public List<string> Keys
		{
			get
			{
				List<string> keys = new List<string>();
				foreach (AlertItem item in items) if (item.Key.Length > 0) keys.Add(item.Key);
				return keys;
			}
		}

		public AlertItem First { get { return items.Count > 0 ? items[0] : null; } }

		protected override bool ShowWithoutActivation { get { return true; } }

		protected override CreateParams CreateParams
		{
			get
			{
				CreateParams cp = base.CreateParams;
				// No activation, no taskbar button, on top.
				cp.ExStyle |= 0x08000000 | 0x00000080 | 0x00000008;
				return cp;
			}
		}

		protected override void OnHandleCreated(EventArgs e)
		{
			base.OnHandleCreated(e);
			rounded = Native.RoundCorners(Handle, Theme.Red);
		}

		/** Shows these warnings (or updates the ones on screen) as the settings say. */
		public void Present(List<AlertItem> list, AlertSettings s, bool isTest)
		{
			bool showing = Visible && !hiding;
			items = new List<AlertItem>(list);
			settings = s.Copy();
			test = isTest;
			hiding = false;
			LayoutCard();
			Rectangle work = Placement.Pick(settings.Screen).WorkingArea;
			Point to = Placement.At(work, Size, settings.Position, (int)(22 * dpi));
			animTimer.Stop();
			if (showing || !settings.Slide)
			{
				Opacity = 1;
				Location = to;
				if (!Visible) Show();
			}
			else
			{
				int off = (int)(56 * dpi);
				string p = settings.Position;
				Point from = to;
				if (p.EndsWith("left")) from.X -= off;
				else if (p.EndsWith("right")) from.X += off;
				else if (p.StartsWith("top")) from.Y -= off;
				else if (p.StartsWith("bottom")) from.Y += off;
				animFrom = from;
				animTo = to;
				animIn = true;
				animMs = 460;
				animStart = DateTime.Now;
				Opacity = 0;
				Location = from;
				Show();
				animTimer.Start();
			}
			if (settings.Pulse) pulseTimer.Start(); else pulseTimer.Stop();
			Invalidate();
		}

		/** Goes, fading out when it came in sliding. */
		public void Withdraw()
		{
			if (!Visible || hiding) return;
			pulseTimer.Stop();
			if (!settings.Slide) { Hide(); return; }
			hiding = true;
			animIn = false;
			animMs = 220;
			animStart = DateTime.Now;
			animTimer.Start();
		}

		void AnimTick(object sender, EventArgs e)
		{
			double t = Math.Min(1, (DateTime.Now - animStart).TotalMilliseconds / animMs);
			if (animIn)
			{
				double ease = 1 - Math.Pow(1 - t, 3);
				Location = new Point(
					(int)Math.Round(animFrom.X + (animTo.X - animFrom.X) * ease),
					(int)Math.Round(animFrom.Y + (animTo.Y - animFrom.Y) * ease));
				Opacity = Math.Min(1, t * 1.6);
			}
			else
			{
				Opacity = 1 - t;
			}
			if (t < 1) return;
			animTimer.Stop();
			if (!animIn)
			{
				Hide();
				hiding = false;
				Opacity = 1;
			}
		}

		void Fonts()
		{
			float k = dpi * settings.Factor();
			if (titleFont != null) { titleFont.Dispose(); lineFont.Dispose(); smallFont.Dispose(); buttonFont.Dispose(); }
			titleFont = new Font("Segoe UI", 17f * k, FontStyle.Bold, GraphicsUnit.Pixel);
			lineFont = new Font("Segoe UI", 13.5f * k, FontStyle.Regular, GraphicsUnit.Pixel);
			smallFont = new Font("Segoe UI", 12f * k, FontStyle.Regular, GraphicsUnit.Pixel);
			buttonFont = new Font("Segoe UI", 14f * k, FontStyle.Bold, GraphicsUnit.Pixel);
		}

		/** The lines under the title: which posts, or a word that there are some. */
		List<string[]> Lines()
		{
			List<string[]> lines = new List<string[]>();
			if (test)
			{
				lines.Add(new string[] { "Test", "This is how a warning looks" });
				lines.Add(new string[] { "", "Nothing failed. Dismiss closes it." });
				return lines;
			}
			if (!settings.ShowTitles)
			{
				lines.Add(new string[] { "", "Open flock to see which." });
				return lines;
			}
			int shown = Math.Min(3, items.Count);
			for (int i = 0; i < shown; i++) lines.Add(new string[] { items[i].Platform, items[i].Title });
			if (items.Count == 1 && items[0].Detail.Length > 0) lines.Add(new string[] { "", items[0].Detail });
			if (items.Count > shown) lines.Add(new string[] { "", "and " + (items.Count - shown) + " more" });
			return lines;
		}

		string Heading()
		{
			if (test) return "Test warning";
			return items.Count == 1 ? "A post did not go out" : items.Count + " posts did not go out";
		}

		void LayoutCard()
		{
			Fonts();
			float k = dpi * settings.Factor();
			int pad = (int)(20 * k);
			int icon = (int)(60 * k);
			int gap = (int)(16 * k);
			int width = (int)(380 * k);
			int lineH = (int)(lineFont.Height * 1.2f);
			int textX = pad + icon + gap;
			int textH = titleFont.Height + (int)(6 * k) + Lines().Count * lineH;
			int top = Math.Max(icon, textH);
			int buttonH = (int)(42 * k);
			int buttonY = pad + top + (int)(18 * k);
			iconBox = new Rectangle(pad, pad, icon, icon);
			textBox = new Rectangle(textX, pad, width - textX - pad, textH);
			int inner = width - pad * 2;
			int dismissW = (int)(inner * 0.58f);
			dismissBox = new Rectangle(pad, buttonY, dismissW, buttonH);
			openBox = new Rectangle(pad + dismissW + (int)(10 * k), buttonY, inner - dismissW - (int)(10 * k), buttonH);
			ClientSize = new Size(width, buttonY + buttonH + pad);
		}

		string HitTest(Point p)
		{
			if (dismissBox.Contains(p)) return "dismiss";
			if (openBox.Contains(p)) return "open";
			return "";
		}

		void SetHover(string what)
		{
			if (what == hover) return;
			hover = what;
			Cursor = what.Length > 0 ? Cursors.Hand : Cursors.Default;
			Invalidate();
		}

		void OnClickCard(object sender, MouseEventArgs e)
		{
			if (e.Button != MouseButtons.Left) return;
			string what = HitTest(e.Location);
			if (what == "dismiss" && DismissClicked != null) DismissClicked(this, EventArgs.Empty);
			if (what == "open" && OpenClicked != null) OpenClicked(this, EventArgs.Empty);
		}

		/** 0 to 1 and back, every 2.8 s, like the sidebar's red box; 0 when it holds still. */
		double Pulse()
		{
			if (!settings.Pulse) return 0;
			double seconds = (DateTime.Now - born).TotalSeconds;
			return 0.5 - 0.5 * Math.Cos(seconds / 2.8 * 2 * Math.PI);
		}

		protected override void OnPaint(PaintEventArgs e)
		{
			Graphics g = e.Graphics;
			g.SmoothingMode = SmoothingMode.AntiAlias;
			g.PixelOffsetMode = PixelOffsetMode.HighQuality;
			float k = dpi * settings.Factor();
			double pulse = Pulse();
			Color red = Theme.Mix(Theme.Red, Theme.RedLow, pulse * 0.85);

			// Windows 10 has no rounded corners or border colour to ask for: a border of our own.
			if (!rounded)
			{
				using (Pen pen = new Pen(Theme.Red, Math.Max(2f, 2f * dpi)))
					g.DrawRectangle(pen, 1, 1, ClientSize.Width - 2, ClientSize.Height - 2);
			}

			// The red box's glow, breathing with it.
			for (int i = 4; i >= 1; i--)
			{
				RectangleF ring = iconBox;
				ring.Inflate(i * 3 * k, i * 3 * k);
				int alpha = (int)((1 - pulse) * (46 - i * 9));
				if (alpha <= 0) continue;
				using (GraphicsPath p = Theme.Round(ring, icon(0.27f) + i * 3 * k))
				using (SolidBrush b = new SolidBrush(Color.FromArgb(alpha, Theme.Red)))
					g.FillPath(b, p);
			}
			using (GraphicsPath box = Theme.Round(iconBox, icon(0.27f)))
			using (SolidBrush fill = new SolidBrush(red))
				g.FillPath(fill, box);
			// The "!" cut out of it, in the card's own dark.
			using (Pen cut = new Pen(Theme.Bg, iconBox.Width * 0.14f))
			{
				cut.StartCap = LineCap.Round;
				cut.EndCap = LineCap.Round;
				float cx = iconBox.X + iconBox.Width / 2f;
				g.DrawLine(cut, cx, iconBox.Y + iconBox.Height * 0.25f, cx, iconBox.Y + iconBox.Height * 0.55f);
				g.DrawLine(cut, cx, iconBox.Y + iconBox.Height * 0.745f, cx, iconBox.Y + iconBox.Height * 0.75f);
			}

			// Where it is from, small, top right.
			TextRenderer.DrawText(g, "flock", smallFont, new Rectangle(0, (int)(10 * k), ClientSize.Width - (int)(14 * k), smallFont.Height),
				Theme.Faint, TextFormatFlags.Right | TextFormatFlags.NoPadding);

			TextFormatFlags one = TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding;
			int y = textBox.Y - (int)(2 * k);
			TextRenderer.DrawText(g, Heading(), titleFont, new Rectangle(textBox.X, y, textBox.Width - (int)(34 * k), titleFont.Height), Theme.Text, one);
			y += titleFont.Height + (int)(6 * k);
			int lineH = (int)(lineFont.Height * 1.2f);
			foreach (string[] line in Lines())
			{
				int x = textBox.X;
				if (line[0].Length > 0)
				{
					string label = line[0] + "  \u00b7  ";
					Size size = TextRenderer.MeasureText(g, label, lineFont, Size.Empty, TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
					TextRenderer.DrawText(g, label, lineFont, new Point(x, y), Theme.Dim, TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
					x += size.Width;
					TextRenderer.DrawText(g, line[1], lineFont, new Rectangle(x, y, textBox.Right - x, lineH), Theme.Text, one);
				}
				else
				{
					TextRenderer.DrawText(g, line[1], lineFont, new Rectangle(x, y, textBox.Right - x, lineH), Theme.Dim, one);
				}
				y += lineH;
			}

			// Dismiss: the one thing to press, red and wide.
			using (GraphicsPath p = Theme.Round(dismissBox, 9 * k))
			using (SolidBrush b = new SolidBrush(hover == "dismiss" ? Theme.RedHot : Theme.Red))
				g.FillPath(b, p);
			TextRenderer.DrawText(g, "Dismiss", buttonFont, dismissBox, Color.White,
				TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);

			using (GraphicsPath p = Theme.Round(openBox, 9 * k))
			using (SolidBrush b = new SolidBrush(Theme.Surface2))
			using (Pen pen = new Pen(hover == "open" ? Theme.Pink : Theme.BorderStrong, Math.Max(1f, 1.4f * dpi)))
			{
				g.FillPath(b, p);
				g.DrawPath(pen, p);
			}
			TextRenderer.DrawText(g, "Open in flock", lineFont, openBox, Theme.Text,
				TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis);
		}

		float icon(float share) { return iconBox.Width * share; }

		/** For Render: the card laid out and drawn without showing it. */
		public Bitmap Snapshot(List<AlertItem> list, AlertSettings s, bool isTest)
		{
			items = new List<AlertItem>(list);
			settings = s.Copy();
			test = isTest;
			LayoutCard();
			Bitmap bmp = new Bitmap(ClientSize.Width, ClientSize.Height);
			using (Graphics g = Graphics.FromImage(bmp))
			{
				g.Clear(BackColor);
				OnPaint(new PaintEventArgs(g, new Rectangle(Point.Empty, ClientSize)));
			}
			return bmp;
		}
	}

	/** The settings window, from the tray menu: where and how the warning shows, and Start with Windows. */
	public class SettingsForm : Form
	{
		public event EventHandler Saved;
		public event EventHandler TestRequested;
		public AlertSettings Result;
		public bool AutostartWanted;

		static readonly string[] Spots = { "top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right" };
		static readonly string[] SpotNames = { "Top left", "Top", "Top right", "Left", "Centre", "Right", "Bottom left", "Bottom", "Bottom right" };

		readonly CheckBox enabled, pulse, slide, titles, autostart;
		readonly ComboBox screen, size;
		readonly RadioButton[] spots = new RadioButton[9];
		readonly List<string> screenValues = new List<string>();
		readonly float dpi;

		public SettingsForm(AlertSettings current, bool autostartOn, bool autostartAvailable, string autostartNote, string startupFolder, Icon icon)
		{
			dpi = Theme.Scale();
			Text = "flock worker \u00b7 Warning settings";
			FormBorderStyle = FormBorderStyle.FixedDialog;
			MaximizeBox = false;
			MinimizeBox = false;
			StartPosition = FormStartPosition.Manual;
			if (icon != null) Icon = icon;
			Font = new Font("Segoe UI", 9.75f);
			BackColor = Theme.Bg;
			ForeColor = Theme.Text;
			AutoSize = true;
			AutoSizeMode = AutoSizeMode.GrowAndShrink;
			TopMost = true;

			TableLayoutPanel table = new TableLayoutPanel();
			table.ColumnCount = 2;
			table.AutoSize = true;
			table.AutoSizeMode = AutoSizeMode.GrowAndShrink;
			table.Padding = new Padding(Px(20), Px(16), Px(20), Px(16));
			table.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
			table.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

			Label intro = Note("A warning shows on screen when a post did not go out, and stays until you press Dismiss. Dismissing it here leaves the post in flock's To finish list.", Theme.Dim);
			AddWide(table, intro);

			enabled = Check("Show a warning when a post did not go out", current.Enabled);
			AddWide(table, enabled);

			screen = Combo();
			Screen second = Placement.Second();
			screen.Items.Add(second.Primary ? "Second screen (there is only one now)" : "Second screen (now " + Placement.Short(second) + ")");
			screenValues.Add("second");
			screen.Items.Add("Main screen"); screenValues.Add("main");
			screen.Items.Add("The screen with the mouse pointer"); screenValues.Add("mouse");
			// Every screen by its number, as Windows numbers them, so with four
			// or more one can be picked for good.
			List<Screen> all = new List<Screen>(Screen.AllScreens);
			all.Sort(delegate(Screen a, Screen b) { return Placement.Number(a).CompareTo(Placement.Number(b)); });
			foreach (Screen s in all) { screen.Items.Add(Placement.Name(s)); screenValues.Add(s.DeviceName); }
			if (!screenValues.Contains(current.Screen))
			{
				screen.Items.Add(current.Screen + " (not connected now)");
				screenValues.Add(current.Screen);
			}
			screen.SelectedIndex = Math.Max(0, screenValues.IndexOf(current.Screen));
			FlowLayoutPanel screenRow = new FlowLayoutPanel();
			screenRow.AutoSize = true;
			screenRow.WrapContents = false;
			screenRow.Margin = new Padding(0);
			screen.Margin = new Padding(0, 0, Px(8), 0);
			Button identify = Btn("Identify", false);
			identify.Margin = new Padding(0);
			// As tall as the dropdown beside it.
			identify.AutoSize = false;
			identify.Padding = new Padding(0);
			identify.Size = new Size(TextRenderer.MeasureText("Identify", Font).Width + Px(28), screen.Height);
			identify.Click += delegate { ScreenNumber.ShowAll(); };
			screenRow.Controls.Add(screen);
			screenRow.Controls.Add(identify);
			AddRow(table, "Screen", screenRow);

			TableLayoutPanel grid = new TableLayoutPanel();
			grid.ColumnCount = 3;
			grid.RowCount = 3;
			grid.AutoSize = true;
			grid.Padding = new Padding(Px(3));
			grid.BackColor = Theme.Border;
			ToolTip tips = new ToolTip();
			for (int i = 0; i < 9; i++)
			{
				RadioButton r = new RadioButton();
				r.Appearance = Appearance.Button;
				r.FlatStyle = FlatStyle.Flat;
				r.FlatAppearance.BorderColor = Theme.BorderStrong;
				r.FlatAppearance.CheckedBackColor = Theme.Pink;
				r.BackColor = Theme.Surface2;
				r.Size = new Size(Px(40), Px(26));
				r.Margin = new Padding(Px(2));
				r.Checked = Spots[i] == current.Position;
				r.TabStop = true;
				tips.SetToolTip(r, SpotNames[i]);
				spots[i] = r;
				grid.Controls.Add(r, i % 3, i / 3);
			}
			if (Array.IndexOf(Spots, current.Position) < 0) spots[2].Checked = true;
			AddRow(table, "Where on it", grid);

			size = Combo();
			size.Items.AddRange(new object[] { "Small", "Medium", "Large" });
			size.SelectedIndex = current.Size == "small" ? 0 : current.Size == "large" ? 2 : 1;
			AddRow(table, "Size", size);

			FlowLayoutPanel look = new FlowLayoutPanel();
			look.FlowDirection = FlowDirection.TopDown;
			look.AutoSize = true;
			look.Margin = new Padding(0);
			pulse = Check("Pulse slowly", current.Pulse);
			slide = Check("Slide in", current.Slide);
			titles = Check("Name the posts (off for screen recordings)", current.ShowTitles);
			look.Controls.Add(pulse);
			look.Controls.Add(slide);
			look.Controls.Add(titles);
			AddRow(table, "Look", look);

			Panel rule = new Panel();
			rule.Height = 1;
			rule.Dock = DockStyle.Fill;
			rule.BackColor = Theme.Border;
			rule.Margin = new Padding(0, Px(10), 0, Px(10));
			AddWide(table, rule);

			autostart = Check("Start with Windows", autostartOn);
			autostart.Enabled = autostartAvailable;
			AddWide(table, autostart);
			if (autostartNote.Length > 0) AddWide(table, Note(autostartNote, Theme.Faint));
			if (startupFolder.Length > 0)
			{
				LinkLabel open = new LinkLabel();
				open.Text = "Open the Startup folder";
				open.AutoSize = true;
				open.LinkColor = Theme.Pink;
				open.ActiveLinkColor = Theme.Pink;
				open.Margin = new Padding(Px(3), 0, 0, Px(4));
				string folder = startupFolder;
				open.LinkClicked += delegate { try { Process.Start(folder); } catch { } };
				AddWide(table, open);
			}

			FlowLayoutPanel buttons = new FlowLayoutPanel();
			buttons.FlowDirection = FlowDirection.LeftToRight;
			buttons.AutoSize = true;
			buttons.Margin = new Padding(0, Px(14), 0, 0);
			Button testButton = Btn("Show a test warning", false);
			testButton.Click += delegate { if (TestRequested != null) TestRequested(this, EventArgs.Empty); };
			Button save = Btn("Save", true);
			save.Click += delegate
			{
				Result = Current();
				AutostartWanted = autostart.Checked;
				if (Saved != null) Saved(this, EventArgs.Empty);
				Close();
			};
			Button cancel = Btn("Cancel", false);
			cancel.Click += delegate { Close(); };
			buttons.Controls.Add(testButton);
			buttons.Controls.Add(save);
			buttons.Controls.Add(cancel);
			AddWide(table, buttons);
			AcceptButton = save;
			CancelButton = cancel;

			Controls.Add(table);
		}

		/** What the window shows now, saved or not - what a test warning uses. */
		public AlertSettings Current()
		{
			AlertSettings s = new AlertSettings();
			s.Enabled = enabled.Checked;
			s.Screen = screenValues[Math.Max(0, screen.SelectedIndex)];
			for (int i = 0; i < 9; i++) if (spots[i].Checked) s.Position = Spots[i];
			s.Size = size.SelectedIndex == 0 ? "small" : size.SelectedIndex == 2 ? "large" : "medium";
			s.Pulse = pulse.Checked;
			s.Slide = slide.Checked;
			s.ShowTitles = titles.Checked;
			return s;
		}

		int Px(float v) { return (int)Math.Round(v * dpi); }

		protected override void OnHandleCreated(EventArgs e)
		{
			base.OnHandleCreated(e);
			Native.DarkTitleBar(Handle);
		}

		/** In the middle of the screen the pointer is on, in front, then an ordinary window. */
		protected override void OnShown(EventArgs e)
		{
			base.OnShown(e);
			if (snapshot) return;
			Rectangle work = Screen.FromPoint(Cursor.Position).WorkingArea;
			Location = new Point(work.Left + (work.Width - Width) / 2, work.Top + (work.Height - Height) / 2);
			// The helper starts hidden, and Windows hands that start-up state to the
			// first ordinary window it shows: this one, which stayed invisible. A
			// second, explicit show is not taken over.
			if (!Native.IsWindowVisible(Handle)) Native.ShowWindow(Handle, 5);
			Activate();
			TopMost = false;
		}

		void AddRow(TableLayoutPanel table, string label, Control control)
		{
			Label l = new Label();
			l.Text = label;
			l.AutoSize = true;
			l.ForeColor = Theme.Dim;
			l.Anchor = AnchorStyles.Left | AnchorStyles.Top;
			l.Margin = new Padding(0, Px(8), Px(18), Px(6));
			control.Margin = new Padding(0, Px(4), 0, Px(6));
			control.Anchor = AnchorStyles.Left | AnchorStyles.Top;
			int row = table.RowCount++;
			table.Controls.Add(l, 0, row);
			table.Controls.Add(control, 1, row);
		}

		void AddWide(TableLayoutPanel table, Control control)
		{
			int row = table.RowCount++;
			table.Controls.Add(control, 0, row);
			table.SetColumnSpan(control, 2);
		}

		Label Note(string text, Color colour)
		{
			Label l = new Label();
			l.Text = text;
			l.AutoSize = true;
			l.MaximumSize = new Size(Px(440), 0);
			l.ForeColor = colour;
			l.Margin = new Padding(Px(3), 0, 0, Px(10));
			return l;
		}

		CheckBox Check(string text, bool on)
		{
			CheckBox c = new CheckBox();
			c.Text = text;
			c.Checked = on;
			c.AutoSize = true;
			c.FlatStyle = FlatStyle.Flat;
			c.FlatAppearance.BorderColor = Theme.BorderStrong;
			c.FlatAppearance.CheckedBackColor = Theme.Pink;
			c.ForeColor = Theme.Text;
			c.Margin = new Padding(Px(3), Px(3), 0, Px(3));
			return c;
		}

		/** A dropdown in flock's dark: drawn by hand, as visual styles ignore its colours. */
		ComboBox Combo()
		{
			ComboBox c = new ComboBox();
			c.DropDownStyle = ComboBoxStyle.DropDownList;
			c.FlatStyle = FlatStyle.Flat;
			c.BackColor = Theme.Surface2;
			c.ForeColor = Theme.Text;
			c.DrawMode = DrawMode.OwnerDrawFixed;
			c.ItemHeight = Font.Height + Px(6);
			c.Width = Px(300);
			c.DrawItem += delegate(object sender, DrawItemEventArgs e)
			{
				bool picked = (e.State & DrawItemState.Selected) != 0 && (e.State & DrawItemState.ComboBoxEdit) == 0;
				using (SolidBrush back = new SolidBrush(picked ? Theme.Pink : Theme.Surface2))
					e.Graphics.FillRectangle(back, e.Bounds);
				if (e.Index < 0) return;
				TextRenderer.DrawText(e.Graphics, c.Items[e.Index].ToString(), c.Font,
					new Rectangle(e.Bounds.X + Px(6), e.Bounds.Y, e.Bounds.Width - Px(6), e.Bounds.Height),
					picked ? Color.White : Theme.Text, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
			};
			return c;
		}

		Button Btn(string text, bool primary)
		{
			Button b = new Button();
			b.Text = text;
			b.AutoSize = true;
			b.Padding = new Padding(Px(10), Px(3), Px(10), Px(3));
			b.FlatStyle = FlatStyle.Flat;
			b.FlatAppearance.BorderColor = primary ? Theme.Pink : Theme.BorderStrong;
			b.BackColor = primary ? Theme.Pink : Theme.Surface2;
			b.ForeColor = primary ? Color.White : Theme.Text;
			if (primary) b.Font = new Font(Font, FontStyle.Bold);
			b.Margin = new Padding(0, 0, Px(8), 0);
			return b;
		}

		bool snapshot;

		/**
		 * For Render: the window drawn to a bitmap. Its controls draw only once
		 * shown, so it is shown fully transparent, far off every screen and
		 * without a taskbar button, for the moment it takes.
		 */
		public Bitmap Snapshot()
		{
			snapshot = true;
			ShowInTaskbar = false;
			Opacity = 0;
			Location = new Point(-32000, -32000);
			Show();
			Application.DoEvents();
			Bitmap bmp = new Bitmap(Width, Height);
			DrawToBitmap(bmp, new Rectangle(Point.Empty, Size));
			Close();
			return bmp;
		}
	}

	/**
	 * The helper: the icon and its menu, the card and the window, and the
	 * lines to and from the worker - one in on stdin per change, a word and
	 * base64 of UTF-8 JSON (alerts.mjs encodeLine), and back out on stdout the
	 * same way. It closes itself when the worker's process has gone or its
	 * stdin ends, so no icon is ever left behind.
	 */
	public class App : ApplicationContext
	{
		const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
		const string ApprovedKey = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

		readonly NotifyIcon tray = new NotifyIcon();
		readonly ContextMenuStrip menu = new ContextMenuStrip();
		readonly Control invoker = new Control();
		readonly JavaScriptSerializer json = new JavaScriptSerializer();
		readonly System.Windows.Forms.Timer watch = new System.Windows.Forms.Timer();
		readonly string title, url, logPath, exePath, runName;
		ToolStripMenuItem startItem;
		Process worker;
		Icon appIcon;
		AlertSettings settings;
		List<AlertItem> current = new List<AlertItem>();
		Card card;
		SettingsForm settingsForm;

		public static void Start(int pid, string title, string url, string logPath, string exePath, string runName, string settings64, string icon64)
		{
			try { Native.SetProcessDPIAware(); } catch { }
			Application.EnableVisualStyles();
			Application.Run(new App(pid, title, url, logPath, exePath, runName, settings64, icon64));
		}

		App(int pid, string title, string url, string logPath, string exePath, string runName, string settings64, string icon64)
		{
			this.title = title;
			this.url = url;
			this.logPath = logPath;
			this.exePath = exePath;
			this.runName = runName;
			settings = AlertSettings.From(Decode(settings64));
			appIcon = LoadIcon(icon64);
			// The pump's way onto this thread: a control with a window handle.
			GC.KeepAlive(invoker.Handle);

			try { worker = Process.GetProcessById(pid); } catch { worker = null; }
			watch.Interval = 1000;
			watch.Tick += delegate { if (worker == null || worker.HasExited) ExitThread(); };
			watch.Start();

			BuildMenu();
			tray.Icon = appIcon;
			tray.Text = Clip(title);
			tray.ContextMenuStrip = menu;
			tray.DoubleClick += delegate { OpenUrl(url); };
			tray.Visible = true;

			Thread pump = new Thread(Pump);
			pump.IsBackground = true;
			pump.Start();
			Send("ready", null);
		}

		static Icon LoadIcon(string icon64)
		{
			try
			{
				Bitmap bitmap = new Bitmap(new MemoryStream(Convert.FromBase64String(icon64)));
				return Icon.FromHandle(bitmap.GetHicon());
			}
			catch { return SystemIcons.Application; }
		}

		static string Clip(string text) { return text.Length > 63 ? text.Substring(0, 63) : text; }

		object Decode(string base64)
		{
			try { return json.DeserializeObject(Encoding.UTF8.GetString(Convert.FromBase64String(base64))); }
			catch { return null; }
		}

		void BuildMenu()
		{
			if (url.Length > 0)
			{
				ToolStripMenuItem open = new ToolStripMenuItem("Open flock");
				open.Font = new Font(open.Font, FontStyle.Bold);
				open.Click += delegate { OpenUrl(url); };
				menu.Items.Add(open);
			}
			if (logPath.Length > 0)
			{
				ToolStripMenuItem log = new ToolStripMenuItem("Open log");
				log.Click += delegate { try { Process.Start("notepad.exe", "\"" + logPath + "\""); } catch { } };
				menu.Items.Add(log);
			}
			menu.Items.Add(new ToolStripSeparator());
			ToolStripMenuItem testItem = new ToolStripMenuItem("Show a test warning");
			testItem.Click += delegate { ShowTest(settings); };
			menu.Items.Add(testItem);
			ToolStripMenuItem settingsItem = new ToolStripMenuItem("Warning settings\u2026");
			settingsItem.Click += delegate { OpenSettings(); };
			menu.Items.Add(settingsItem);
			if (exePath.Length > 0)
			{
				startItem = new ToolStripMenuItem("Start with Windows");
				startItem.Click += delegate { SetAutostart(!AutostartOn()); };
				menu.Items.Add(startItem);
				menu.Opening += delegate { startItem.Checked = AutostartOn(); };
			}
			menu.Items.Add(new ToolStripSeparator());
			ToolStripMenuItem stop = new ToolStripMenuItem("Stop flock worker");
			stop.Click += delegate
			{
				stop.Enabled = false;
				tray.Text = "flock worker: stopping";
				Send("stop", null);
			};
			menu.Items.Add(stop);
		}

		void Pump()
		{
			try
			{
				string line;
				while ((line = Console.In.ReadLine()) != null)
				{
					string l = line;
					invoker.BeginInvoke(new Action<string>(Handle), l);
				}
			}
			catch { }
			try { invoker.BeginInvoke(new Action(ExitThread)); } catch { }
		}

		void Handle(string line)
		{
			line = line.Trim();
			if (line.Length == 0) return;
			int at = line.IndexOf(' ');
			string type = at < 0 ? line : line.Substring(0, at);
			object payload = at < 0 ? null : Decode(line.Substring(at + 1));
			IDictionary<string, object> d = payload as IDictionary<string, object>;
			if (type == "show")
			{
				object items;
				current = AlertItem.ListFrom(d != null && d.TryGetValue("items", out items) ? items : null);
				ShowCurrent();
			}
			else if (type == "hide")
			{
				current.Clear();
				if (card != null && !card.IsTest) card.Withdraw();
				UpdateTip();
			}
			else if (type == "settings")
			{
				settings = AlertSettings.From(payload);
				if (card != null && card.Visible && !card.IsTest) ShowCurrent();
			}
		}

		void Send(string type, object payload)
		{
			string line = payload == null ? type : type + " " + Convert.ToBase64String(Encoding.UTF8.GetBytes(json.Serialize(payload)));
			try
			{
				Console.Out.WriteLine(line);
				Console.Out.Flush();
			}
			catch { }
		}

		void Log(string text)
		{
			Dictionary<string, object> d = new Dictionary<string, object>();
			d["text"] = text;
			Send("log", d);
		}

		void UpdateTip()
		{
			tray.Text = Clip(current.Count == 0 ? title
				: current.Count == 1 ? "flock: a post did not go out"
				: "flock: " + current.Count + " posts did not go out");
		}

		Card EnsureCard()
		{
			if (card != null && !card.IsDisposed) return card;
			card = new Card();
			card.DismissClicked += OnDismiss;
			card.OpenClicked += delegate
			{
				AlertItem first = card.First;
				OpenUrl(first != null && first.Url.Length > 0 ? first.Url : url);
			};
			return card;
		}

		void ShowCurrent()
		{
			UpdateTip();
			if (current.Count == 0 || !settings.Enabled)
			{
				if (card != null && !card.IsTest) card.Withdraw();
				return;
			}
			EnsureCard().Present(current, settings, false);
		}

		void ShowTest(AlertSettings s)
		{
			AlertItem sample = new AlertItem();
			sample.Url = url;
			EnsureCard().Present(new List<AlertItem>(new AlertItem[] { sample }), s, true);
		}

		void OnDismiss(object sender, EventArgs e)
		{
			bool wasTest = card.IsTest;
			List<string> keys = card.Keys;
			card.Withdraw();
			if (wasTest)
			{
				// A test that covered real warnings gives them back.
				if (current.Count > 0) ShowCurrent();
				return;
			}
			Dictionary<string, object> d = new Dictionary<string, object>();
			d["keys"] = keys;
			Send("dismiss", d);
			current.RemoveAll(delegate(AlertItem item) { return keys.Contains(item.Key); });
			UpdateTip();
		}

		void OpenUrl(string address)
		{
			if (string.IsNullOrEmpty(address)) return;
			try { Process.Start(address); } catch (Exception ex) { Log("could not open " + address + ": " + ex.Message); }
		}

		void OpenSettings()
		{
			if (settingsForm != null && !settingsForm.IsDisposed)
			{
				settingsForm.Activate();
				return;
			}
			string folder = StartupShortcut();
			settingsForm = new SettingsForm(settings, AutostartOn(), exePath.Length > 0, AutostartNote(folder), folder, appIcon);
			settingsForm.TestRequested += delegate { ShowTest(settingsForm.Current()); };
			settingsForm.Saved += delegate
			{
				settings = settingsForm.Result;
				Send("settings", settings.ToDict());
				if (exePath.Length > 0 && settingsForm.AutostartWanted != AutostartOn()) SetAutostart(settingsForm.AutostartWanted);
				if (card != null && card.Visible)
				{
					if (card.IsTest) card.Withdraw();
					else ShowCurrent();
				}
			};
			settingsForm.Show();
		}

		/* ---- start with Windows: the Run entry, as Windows' own Startup apps list shows it ---- */

		string Command { get { return "\"" + exePath + "\" --autostart"; } }

		string RegisteredCommand()
		{
			using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKey))
				return key == null ? null : key.GetValue(runName) as string;
		}

		/** On: the entry starts this very program, and Windows' Startup apps has not switched it off. */
		bool AutostartOn()
		{
			if (exePath.Length == 0) return false;
			try
			{
				string registered = RegisteredCommand();
				if (registered == null || !string.Equals(registered.Trim(), Command, StringComparison.OrdinalIgnoreCase)) return false;
				using (RegistryKey key = Registry.CurrentUser.OpenSubKey(ApprovedKey))
				{
					byte[] state = key == null ? null : key.GetValue(runName) as byte[];
					if (state != null && state.Length > 0 && (state[0] & 1) == 1) return false;
				}
				return true;
			}
			catch { return false; }
		}

		void SetAutostart(bool on)
		{
			try
			{
				using (RegistryKey key = Registry.CurrentUser.CreateSubKey(RunKey))
				{
					if (on) key.SetValue(runName, Command);
					else key.DeleteValue(runName, false);
				}
				// Whatever Windows' Startup apps list last said about it goes with it.
				using (RegistryKey key = Registry.CurrentUser.CreateSubKey(ApprovedKey))
					key.DeleteValue(runName, false);
				Log(on ? "start with Windows: on (" + Command + ")" : "start with Windows: off");
			}
			catch (Exception ex)
			{
				Log("start with Windows could not be changed: " + ex.Message);
				MessageBox.Show("Start with Windows could not be changed:\n\n" + ex.Message, "flock worker", MessageBoxButtons.OK, MessageBoxIcon.Warning);
			}
		}

		/** A shortcut in the Startup folder with flock in its name: the old way of starting it. */
		string StartupShortcut()
		{
			try
			{
				string folder = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
				foreach (string file in Directory.GetFiles(folder, "*.lnk"))
					if (Path.GetFileName(file).IndexOf("flock", StringComparison.OrdinalIgnoreCase) >= 0) return folder;
			}
			catch { }
			return "";
		}

		string AutostartNote(string shortcutFolder)
		{
			if (exePath.Length == 0) return "Only flock-worker-background.exe can start with Windows; this one runs from a script.";
			List<string> notes = new List<string>();
			try
			{
				string registered = RegisteredCommand();
				if (registered != null && !string.Equals(registered.Trim(), Command, StringComparison.OrdinalIgnoreCase))
					notes.Add("Windows starts another copy now: " + registered + ". Ticking this starts this one instead.");
			}
			catch { }
			if (shortcutFolder.Length > 0)
				notes.Add("Your Startup folder also has a flock shortcut, which starts it too. With this ticked, delete that shortcut.");
			if (notes.Count == 0) notes.Add("Starts this program when you sign in to Windows. Windows' own Settings, Apps, Startup lists it too.");
			return string.Join("\n", notes.ToArray());
		}

		protected override void ExitThreadCore()
		{
			watch.Stop();
			tray.Visible = false;
			tray.Dispose();
			if (card != null) card.Dispose();
			if (settingsForm != null && !settingsForm.IsDisposed) settingsForm.Dispose();
			base.ExitThreadCore();
		}

		/**
		 * Draws the card in each size and the settings window to PNG files in
		 * dir, without showing anything: how they are checked by eye.
		 */
		public static void Render(string dir, string icon64)
		{
			try { Native.SetProcessDPIAware(); } catch { }
			Application.EnableVisualStyles();
			List<AlertItem> one = new List<AlertItem>();
			AlertItem a = new AlertItem();
			a.Platform = "Instagram";
			a.Title = "Owls at dusk, and what they do when nobody is looking";
			a.Detail = "Instagram refused the upload (400): ProcessingFailedError";
			one.Add(a);
			List<AlertItem> many = new List<AlertItem>(one);
			string[] more = { "TikTok|Paper Moon over the old harbour", "YouTube|A very long title that goes on and on until it has to be cut short", "TikTok|Fourth", "YouTube|Fifth" };
			foreach (string m in more)
			{
				AlertItem b = new AlertItem();
				b.Platform = m.Split('|')[0];
				b.Title = m.Split('|')[1];
				many.Add(b);
			}
			string[] sizes = { "small", "medium", "large" };
			foreach (string sz in sizes)
			{
				AlertSettings s = new AlertSettings();
				s.Size = sz;
				s.Pulse = false;
				using (Card c = new Card()) using (Bitmap bmp = c.Snapshot(one, s, false)) bmp.Save(Path.Combine(dir, "card-" + sz + ".png"), ImageFormat.Png);
			}
			AlertSettings plain = new AlertSettings();
			plain.Pulse = false;
			using (Card c = new Card()) using (Bitmap bmp = c.Snapshot(many, plain, false)) bmp.Save(Path.Combine(dir, "card-many.png"), ImageFormat.Png);
			plain.ShowTitles = false;
			using (Card c = new Card()) using (Bitmap bmp = c.Snapshot(many, plain, false)) bmp.Save(Path.Combine(dir, "card-untitled.png"), ImageFormat.Png);
			using (Card c = new Card()) using (Bitmap bmp = c.Snapshot(one, new AlertSettings(), true)) bmp.Save(Path.Combine(dir, "card-test.png"), ImageFormat.Png);
			using (SettingsForm f = new SettingsForm(new AlertSettings(), false, true, "Starts this program when you sign in to Windows. Windows' own Settings, Apps, Startup lists it too.", "", LoadIcon(icon64)))
			using (Bitmap bmp = f.Snapshot())
				bmp.Save(Path.Combine(dir, "settings.png"), ImageFormat.Png);
		}
	}
}
`;
