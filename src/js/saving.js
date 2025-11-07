document.addEventListener("DOMContentLoaded", () => {
  const goals = [
    {
      title: "Emergency Fund",
      progress: 65,
      saved: "₹5,20,000",
      target: "₹8,00,000",
      icon: "fa-shield-heart",
      theme: "emergency",
      note: "Building a 6-month expense buffer",
    },
    {
      title: "Vacation Fund",
      progress: 56,
      saved: "₹2,24,000",
      target: "₹4,00,000",
      icon: "fa-umbrella-beach",
      theme: "vacation",
      note: "Trip planned for December",
    },
    {
      title: "New Laptop",
      progress: 83,
      saved: "₹1,32,000",
      target: "₹1,60,000",
      icon: "fa-laptop-code",
      theme: "laptop",
      note: "Upgrade scheduled in 2 months",
    },
  ];

  const insights = [
    {
      title: "Reduce Subscription Costs",
      description:
        "You have 5 active subscriptions. Consider canceling Netflix and Hulu as they overlap. Potential savings: ₹2,000/month.",
      savings: "₹24,000/year",
      impact: "High Impact",
      impactLevel: "high",
      icon: "fa-bullseye",
      theme: "subscriptions",
    },
    {
      title: "Optimize Entertainment Spending",
      description:
        "Your entertainment spending is 15% above your category average. Try setting a weekly limit of ₹4,000.",
      savings: "₹9,600/month",
      impact: "Medium Impact",
      impactLevel: "medium",
      icon: "fa-film",
      theme: "entertainment",
    },
    {
      title: "Switch to Better Utilities Plan",
      description:
        "Based on your usage patterns, switching to Provider B's plan could save you money on electricity.",
      savings: "₹3,600/month",
      impact: "Medium Impact",
      impactLevel: "medium",
      icon: "fa-bolt",
      theme: "utilities",
    },
    {
      title: "Meal Planning Opportunity",
      description:
        "You spent ₹22,400 on dining out last month. Planning 2 more home meals per week could reduce this significantly.",
      savings: "₹12,000/month",
      impact: "High Impact",
      impactLevel: "high",
      icon: "fa-bowl-food",
      theme: "meals",
    },
  ];

  const goalGrid = document.getElementById("goalGrid");
  const insightGrid = document.getElementById("insightGrid");

  if (goalGrid) {
    goalGrid.innerHTML = goals
      .map((goal) => {
        const progress = Math.max(0, Math.min(goal.progress, 100));
        return `
					<article class="goal-card" aria-label="${goal.title}">
						<div class="goal-header">
							<div class="goal-details">
								<div class="goal-icon ${goal.theme}">
									<i class="fas ${goal.icon}" aria-hidden="true"></i>
								</div>
								<div class="goal-title">
									<h3>${goal.title}</h3>
									<span>${goal.note}</span>
								</div>
							</div>
							<span class="goal-percentage">${progress}%</span>
						</div>
						<div class="goal-progress" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">
							<div class="progress-track">
								<div class="progress-fill" style="width: ${progress}%"></div>
							</div>
						</div>
						<div class="goal-stats">
							<span class="saved">${goal.saved}</span>
							<span class="target">of ${goal.target}</span>
						</div>
					</article>
				`;
      })
      .join("");
  }

  if (insightGrid) {
    insightGrid.innerHTML = insights
      .map(
        (insight) => `
				<article class="insight-card">
					<div class="insight-body">
						<div class="insight-icon ${insight.theme}">
							<i class="fas ${insight.icon}" aria-hidden="true"></i>
						</div>
						<div class="insight-details">
							<div class="insight-heading">
								<h3>${insight.title}</h3>
								<span class="impact-pill ${insight.impactLevel}">${insight.impact}</span>
							</div>
							<p>${insight.description}</p>
						</div>
					</div>
					<div class="insight-footer">
						<span class="insight-savings">
							<i class="fas fa-arrow-trend-up" aria-hidden="true"></i>
							${insight.savings}
						</span>
						<button class="btn-secondary" type="button">Apply</button>
					</div>
				</article>
			`
      )
      .join("");
  }
});
